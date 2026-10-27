// Голос в каналах через SFU LiveKit (docs/VOICE-SFU.md): Opus 48 кГц по WebRTC вместо PCM 16 кГц по
// WebSocket. Сервер Vicinity остаётся «кто где»: voice_join/voice_state/voice_speaking идут по /ws как раньше
// (lib/voice.ts), а сам звук — в комнату `voice-<channelId>` на LiveKit по токену от GET /rtc/sfu.
// Микрофон проходит ту же обработку, что и в старом движке: RNNoise и усиление в одном AudioContext.
import {
  AudioPresets,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { SfuJoin } from './api';
import { applyOutputToContext, createDenoiseNode, openMic, rtcIceServers, stopStream, useDenoise, useMediaPrefs, wantDenoise } from './media';
import { pttHeld } from './ptt';
import { useStore } from './store';

// Не подключились за это время — голос идёт по-старому (PCM через WebSocket)
const CONNECT_TIMEOUT = 8_000;
// Рация: состояние клавиши проверяем так часто (мс)
const PTT_TICK = 30;

/** identity участника LiveKit — "u<user_id>" (backend/utils/Sfu.cc) */
export const userIdOf = (identity: string): number => {
  const m = /^u(\d+)$/.exec(identity);
  return m ? Number(m[1]) : 0;
};

interface Hooks {
  /** Сам говорит / замолчал — lib/voice.ts шлёт voice_speaking и рисует кольцо */
  onSpeaking: (speaking: boolean) => void;
  /** Комната пропала не по нашей воле (сервер SFU перезапущен, сеть) — lib/voice.ts входит заново */
  onLost: () => void;
  /** Раз в полсекунды: пакеты Opus отправлено, байт получено (с начала входа), участников (window.__vicinityVoiceStats, e2e) */
  onStats: (s: { sfuPacketsSent: number; sfuBytesReceived: number; sfuPeers: number }) => void;
  /** Раз в ~2 с: задержка до SFU в мс (RTT выбранной пары кандидатов); 0 — ещё не измерена */
  onRtt: (rttMs: number) => void;
}

// Как часто обновляем счётчики пакетов (мс)
const STATS_TICK = 500;
// Пинг измеряем каждый четвёртый тик статистики (раз в 2 с)
const RTT_EVERY = 4;

export class SfuEngine {
  readonly room: Room;
  private ctx: AudioContext;
  private gain: GainNode;
  private dest: MediaStreamAudioDestinationNode;
  private source: MediaStreamAudioSourceNode | null = null;
  private denoise: AudioWorkletNode | null = null;
  private denoiseLoad: Promise<AudioWorkletNode | null> | null = null;
  private mic: MediaStream | null = null;
  private micSeq = 0;
  private pub: LocalTrackPublication | null = null;
  private muted = false;
  private deafened = false;
  private volume = 1;
  private micGain = 1;
  private pttTimer: number | undefined;
  private pttOn = false;
  private statsTimer: number | undefined;
  private statsTick = 0;
  /** Байты приёма по дорожкам: счётчик WebRTC начинается с нуля после переподписки — копим сами */
  private rx = new Map<string, { base: number; last: number }>();
  /** Элементы <audio> удалённых дорожек — вне DOM не играют в Safari */
  private sink = document.createElement('div');
  private closed = false;
  private wanted = false; // мы хотим быть в комнате (отличает свой disconnect от потери)

  constructor(private hooks: Hooks) {
    const chromium = /Chrome\//.test(navigator.userAgent);
    this.ctx = new AudioContext(chromium ? { latencyHint: 'interactive', sampleRate: 48000 } : { latencyHint: 'interactive' });
    void this.ctx.resume().catch(() => {});
    this.gain = this.ctx.createGain();
    this.dest = this.ctx.createMediaStreamDestination();
    this.gain.connect(this.dest);
    this.sink.hidden = true;
    this.sink.setAttribute('data-sfu-audio', '');
    document.body.appendChild(this.sink);
    const p = useMediaPrefs.getState();
    this.volume = p.volume;
    this.micGain = p.micGain;
    this.gain.gain.value = p.ptt ? 0 : p.micGain;

    this.room = new Room({
      adaptiveStream: false,
      dynacast: false,
      // Только наша дорожка с обработкой; камера и экран пока идут старым путём (lib/voiceVideo.ts)
      audioCaptureDefaults: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
      publishDefaults: { dtx: true, red: true, audioPreset: AudioPresets.speech },
    });
    this.room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.setAttribute('data-user', String(userIdOf(participant.identity)));
        this.sink.appendChild(el);
        participant.setVolume(this.deafened ? 0 : this.volume);
      })
      // «Не слышать» — не получать чужой звук вовсе, а не только не играть (канал и процессор)
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication) => {
        if (this.deafened) pub.setSubscribed(false);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => p.setVolume(this.deafened ? 0 : this.volume))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => this.onSpeakers(speakers))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        // Браузер не дал играть звук без жеста — включим при первом клике
        if (!this.room.canPlaybackAudio) document.addEventListener('click', () => void this.room.startAudio(), { once: true });
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (this.closed || !this.wanted) return;
        // Сами вышли из комнаты (смена канала) — не потеря
        if (reason === DisconnectReason.CLIENT_INITIATED) return;
        this.hooks.onLost();
      });
    this.setOutput(p.outputId);
    // Для отладки в консоли и e2e: состояние комнаты, подписки, ICE
    (window as unknown as { __vicinitySfuRoom?: Room }).__vicinitySfuRoom = this.room;
  }

  /** Подключиться к комнате канала (или перейти в другую) и опубликовать микрофон */
  async connect(info: SfuJoin): Promise<void> {
    this.wanted = true;
    if (this.room.state !== ConnectionState.Disconnected) await this.room.disconnect(false);
    const url = new URL(info.url, location.href);
    url.protocol = url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
    const iceServers = await rtcIceServers();
    await Promise.race([
      this.room.connect(url.href.replace(/\/$/, ''), info.token, { autoSubscribe: true, rtcConfig: { iceServers } }),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('SFU не ответил')), CONNECT_TIMEOUT)),
    ]);
    if (this.closed) throw new Error('closed');
    this.room.remoteParticipants.forEach((p) => p.setVolume(this.deafened ? 0 : this.volume));
    await this.publish();
    window.clearInterval(this.statsTimer);
    this.statsTimer = window.setInterval(() => void this.pollStats(), STATS_TICK);
  }

  private async pollStats() {
    if (this.closed || this.room.state !== ConnectionState.Connected) return;
    try {
      const local = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      const sent = local && 'getSenderStats' in local ? await (local as { getSenderStats(): Promise<{ packetsSent?: number } | undefined> }).getSenderStats() : undefined;
      for (const p of this.room.remoteParticipants.values())
        for (const pub of p.audioTrackPublications.values()) {
          const t = pub.track as RemoteAudioTrack | undefined;
          if (!t) continue;
          const bytes = (await t.getReceiverStats())?.bytesReceived ?? 0;
          const row = this.rx.get(pub.trackSid) ?? { base: 0, last: 0 };
          if (bytes < row.last) row.base += row.last; // новая подписка — счётчик с нуля
          row.last = bytes;
          this.rx.set(pub.trackSid, row);
        }
      let received = 0;
      this.rx.forEach((r) => (received += r.base + r.last));
      this.hooks.onStats({ sfuPacketsSent: sent?.packetsSent ?? 0, sfuBytesReceived: received, sfuPeers: this.room.remoteParticipants.size });
      // Пинг — реже: getStats() со всем отчётом дороже счётчиков
      if (++this.statsTick % RTT_EVERY === 0 && local) {
        const report = await local.getRTCStatsReport();
        let rtt = 0;
        report?.forEach((r) => {
          if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
        });
        this.hooks.onRtt(Math.round(rtt));
      }
    } catch {
      /* статистика — не повод ронять голос */
    }
  }

  private async publish() {
    const track = this.dest.stream.getAudioTracks()[0];
    this.pub = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Microphone,
      name: 'mic',
      dtx: true,
      red: true,
      audioPreset: AudioPresets.speech,
      stopMicTrackOnMute: false,
    });
    if (this.muted || this.deafened) await this.pub.mute();
  }

  private loadDenoise(): Promise<AudioWorkletNode | null> {
    this.denoiseLoad ??= createDenoiseNode(this.ctx).then(
      (node) => (this.denoise = node),
      () => null,
    );
    return this.denoiseLoad;
  }

  async openMic(deviceId: string) {
    const seq = ++this.micSeq;
    const rnnoise = wantDenoise();
    const [mic, denoise] = await Promise.all([openMic(deviceId, { inline: true }), rnnoise ? this.loadDenoise() : null]);
    if (this.closed || seq !== this.micSeq) return stopStream(mic);
    this.source?.disconnect();
    this.denoise?.disconnect();
    stopStream(this.mic);
    this.mic = mic;
    this.source = this.ctx.createMediaStreamSource(mic);
    if (denoise) this.source.connect(denoise).connect(this.gain);
    else {
      this.source.connect(this.gain);
      if (!rnnoise && useDenoise.getState().status === 'on') useDenoise.setState({ status: 'off' });
    }
    mic.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.mic === mic) useStore.getState().toast('Микрофон отключился — выберите другой в настройках голоса', 'error');
    });
    this.syncPtt();
  }

  // Рация: пока клавиша не зажата, в комнату идёт тишина (усиление 0 — без сигналинга на каждое нажатие)
  private syncPtt() {
    const ptt = useMediaPrefs.getState().ptt;
    window.clearInterval(this.pttTimer);
    this.pttTimer = undefined;
    if (!ptt) {
      this.gain.gain.setTargetAtTime(this.micGain, this.ctx.currentTime, 0.01);
      this.pttOn = false;
      return;
    }
    this.pttTimer = window.setInterval(() => {
      const on = pttHeld() && !this.muted && !this.deafened;
      if (on === this.pttOn) return;
      this.pttOn = on;
      this.gain.gain.setTargetAtTime(on ? this.micGain : 0, this.ctx.currentTime, 0.005);
      this.hooks.onSpeaking(on);
    }, PTT_TICK);
  }

  private onSpeakers(speakers: Participant[]) {
    const me = this.room.localParticipant;
    // Свой индикатор — по оценке SFU, кроме рации: там говорит состояние клавиши
    if (!useMediaPrefs.getState().ptt) this.hooks.onSpeaking(speakers.includes(me) && !this.muted && !this.deafened);
    // Остальные: в store только участники комнаты (говорящие по /ws из старых клиентов не трогаем)
    const s = useStore.getState();
    const next = { ...s.speaking };
    let changed = false;
    this.room.remoteParticipants.forEach((p) => {
      const id = userIdOf(p.identity);
      if (!id) return;
      const on = speakers.includes(p);
      if (!!next[id] !== on) {
        next[id] = on;
        changed = true;
      }
    });
    if (changed) useStore.setState({ speaking: next });
  }

  /** Режим рации включили/выключили в настройках */
  setPtt() {
    this.syncPtt();
  }

  setMuted(muted: boolean, deafened: boolean) {
    this.muted = muted;
    const wasDeaf = this.deafened;
    this.deafened = deafened;
    const off = muted || deafened;
    if (this.pub) void (off ? this.pub.mute() : this.pub.unmute()).catch(() => {});
    this.room.remoteParticipants.forEach((p) => {
      p.setVolume(deafened ? 0 : this.volume);
      if (deafened !== wasDeaf) p.audioTrackPublications.forEach((pub) => pub.setSubscribed(!deafened));
    });
    this.syncPtt();
  }

  setGain(g: number) {
    this.micGain = g;
    this.syncPtt();
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.deafened) this.room.remoteParticipants.forEach((p) => p.setVolume(v));
  }

  setOutput(deviceId: string) {
    void this.room.switchActiveDevice('audiooutput', deviceId || 'default').catch(() => {});
    applyOutputToContext(this.ctx, deviceId);
  }

  /** У старого движка — сброс буферов; здесь нечего сбрасывать */
  reset() {}

  close() {
    this.closed = true;
    this.wanted = false;
    window.clearInterval(this.pttTimer);
    window.clearInterval(this.statsTimer);
    this.source?.disconnect();
    this.denoise?.disconnect();
    if (this.denoise && useDenoise.getState().status === 'on') useDenoise.setState({ status: 'off' });
    stopStream(this.mic);
    this.mic = null;
    void this.room.disconnect(false).catch(() => {});
    this.sink.remove();
    void this.ctx.close().catch(() => {});
  }
}
