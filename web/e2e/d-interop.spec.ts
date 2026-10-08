import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { uniqueName } from './helpers';

// Звонки 1:1 десктоп ↔ браузер (docs/CALLS.md). Десктоп — настоящий CallEngine клиента без UI и
// аудиоустройств: client/tools/call_interop (cmake -DVICINITY_BUILD_INTEROP=ON), путь к нему —
// VICINITY_INTEROP_BIN. Браузер — RTCPeerConnection Chromium по CALLS.md §5.2/§5.3, свой WebSocket.
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const ORIGIN = `http://localhost:${port}`;
const API = `${ORIGIN}/api/v1`;
const HARNESS = process.env.VICINITY_INTEROP_BIN ?? '';

test.skip(
  !HARNESS || !existsSync(HARNESS),
  'Нет десктопного call_interop: соберите client с -DVICINITY_BUILD_INTEROP=ON и задайте VICINITY_INTEROP_BIN',
);

interface Account {
  id: number;
  token: string;
}

async function register(request: APIRequestContext, name: string): Promise<Account> {
  const r = await request.post(`${API}/auth/register`, {
    data: { username: uniqueName('call'), password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token };
}

async function makeFriends(request: APIRequestContext, a: Account, b: Account) {
  const post = (from: Account, path: string, data: unknown) =>
    request.post(`${API}${path}`, { headers: { Authorization: `Bearer ${from.token}` }, data });
  expect((await post(a, '/friends/request', { user_id: b.id })).status()).toBe(201);
  expect((await post(b, '/friends/respond', { user_id: a.id, accept: true })).status()).toBe(200);
}

/** Процесс call_interop: JSON-события из stdout, «hangup» в stdin. */
class Desktop {
  readonly events: any[] = [];
  private stderr = '';
  private readonly proc: ChildProcess;
  private readonly exited: Promise<number | null>;

  constructor(token: string, peer: number, mode: 'call' | 'answer') {
    this.proc = spawn(HARNESS, ['--server', ORIGIN, '--token', token, '--peer', String(peer), '--mode', mode, '--timeout', '50'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    this.proc.stdout!.on('data', (chunk) => {
      buf += chunk;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          this.events.push(JSON.parse(line));
        } catch {
          /* не JSON — диагностический вывод */
        }
      }
    });
    this.proc.stderr!.on('data', (chunk) => (this.stderr += chunk));
    this.exited = new Promise((resolve) => this.proc.on('exit', (code) => resolve(code)));
  }

  async waitFor(what: string, pred: (e: any) => boolean, timeout = 20_000) {
    await expect
      .poll(() => this.events.some(pred), { timeout, message: `${what}\n${this.stderr.slice(-3000)}` })
      .toBe(true);
  }

  hangup() {
    this.proc.stdin!.write('hangup\n');
  }

  /** Всё, что процесс написал: события и stderr (libdatachannel/Qt). */
  log(): string {
    return `${this.events.map((e) => JSON.stringify(e)).join('\n')}\n--- stderr ---\n${this.stderr}`;
  }

  /** Код выхода (null — убит сигналом, т.е. упал). */
  exitCode(): Promise<number | null> {
    return this.exited;
  }

  kill() {
    if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill('SIGKILL');
  }
}

/** Браузерный участник на чистой странице: свой WS, тон 660 Гц вместо микрофона. */
async function installPeer(page: Page, token: string, peer: number) {
  await page.goto('/');
  await page.evaluate(
    async ({ token, peer }) => {
      // Разрешённый getUserMedia — Chrome отдаёт настоящие host-адреса вместо mDNS (CALLS.md §4.2.5)
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 660;
      const gain = ac.createGain();
      gain.gain.value = 0.25;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      await ac.resume();
      const tone = dest.stream.getAudioTracks()[0];

      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
      const st: any = {
        pc: null,
        invite: null,
        offerSdp: '',
        answerSdp: '',
        ended: '',
        ends: [] as string[],
        ctrl: [] as string[],
        pendingRemote: [] as RTCIceCandidateInit[],
        localIce: [] as any[],
        iceOpen: false,
      };
      (window as any).__peer = st;
      const send = (m: unknown) => ws.send(JSON.stringify(m));
      const flushLocalIce = () => {
        st.iceOpen = true;
        for (const m of st.localIce.splice(0)) send(m);
      };
      const setupCtrl = (ch: RTCDataChannel) => {
        ch.onmessage = (e) => st.ctrl.push(String(e.data));
        const hello = () => ch.send(JSON.stringify({ video: false, screen: false }));
        if (ch.readyState === 'open') hello();
        else ch.onopen = hello;
      };
      const newPc = () => {
        const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
        pc.onicecandidate = (e) => {
          if (!e.candidate || !e.candidate.candidate) return;
          const m = { type: 'rtc_ice', to: peer, candidate: e.candidate.candidate, mid: e.candidate.sdpMid };
          if (st.iceOpen) send(m);
          else st.localIce.push(m); // до call_invite / call_accept кандидаты не шлём
        };
        pc.ontrack = (e) => {
          const el = new Audio();
          el.srcObject = new MediaStream([e.track]);
          void el.play().catch(() => undefined);
        };
        pc.ondatachannel = (e) => setupCtrl(e.channel);
        st.pc = pc;
        return pc;
      };
      const addRemote = async (c: RTCIceCandidateInit) => {
        if (st.pc && st.pc.remoteDescription) await st.pc.addIceCandidate(c).catch(() => undefined);
        else st.pendingRemote.push(c);
      };
      const flushRemote = async () => {
        for (const c of st.pendingRemote.splice(0)) await st.pc.addIceCandidate(c).catch(() => undefined);
      };

      ws.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        if (m.from !== undefined && m.from !== peer) return;
        if (m.type === 'call_invite') {
          st.invite = m;
          st.offerSdp = m.sdp;
        } else if (m.type === 'call_accept' && st.pc) {
          st.answerSdp = m.sdp;
          try {
            await st.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
          } catch {
            return; // ответ на подправленный offer (withH264)
          }
          await flushRemote();
        } else if (m.type === 'rtc_ice') {
          await addRemote({ candidate: String(m.candidate).replace(/^a=/, ''), sdpMid: m.mid });
        } else if (['call_end', 'call_reject', 'call_busy', 'call_unavailable'].includes(m.type)) {
          // Первое завершение — главное: дальше на запоздалые rtc_ice сервер ответит call_unavailable
          st.ended ||= m.type;
          st.ends.push(m.type);
          st.pc?.close();
        }
      };

      const w = window as any;
      // Браузер принимает звонок десктопа (§5.2)
      w.__accept = async (badAnswer = false) => {
        const pc = newPc();
        await pc.setRemoteDescription({ type: 'offer', sdp: st.invite.sdp });
        await flushRemote();
        for (const t of pc.getTransceivers()) t.direction = 'sendrecv';
        const audio = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio')!;
        await audio.sender.replaceTrack(tone);
        await pc.setLocalDescription(await pc.createAnswer());
        st.answerSdp = pc.localDescription!.sdp;
        send({ type: 'call_accept', to: peer, sdp: badAnswer ? 'v=0\r\nnot an sdp' : st.answerSdp, sdpType: 'answer' });
        flushLocalIce();
      };
      // В Chromium Playwright нет H264: добавляем в видео-линии offer'а (только в отправляемую копию)
      // H264 разных профилей, чтобы проверить выбор PT десктопом. Ответ браузер применить не сможет.
      const withH264 = (sdp: string) =>
        sdp
          .split(/(?=^m=)/m)
          .map((sec) => {
            if (!sec.startsWith('m=video')) return sec;
            const codecs: [number, string][] = [
              [123, 'packetization-mode=1;profile-level-id=640c1f'],
              [122, 'packetization-mode=0;profile-level-id=42e01f'],
              [120, 'packetization-mode=1;profile-level-id=42001f'],
              [121, 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'],
            ];
            const lines = codecs.flatMap(([pt, fmtp]) => [`a=rtpmap:${pt} H264/90000`, `a=fmtp:${pt} ${fmtp}`]);
            return sec
              .replace(/^(m=video \S+ \S+)/m, `$1 ${codecs.map(([pt]) => pt).join(' ')}`)
              .replace(/\r\n$/, `\r\n${lines.join('\r\n')}\r\n`);
          })
          .join('');
      // Браузер звонит десктопу обычным offer'ом (§5.3, вариант A); audioOnly — без видео и «ctrl»
      w.__call = async (audioOnly = false, injectH264 = false) => {
        const pc = newPc();
        pc.addTransceiver(tone, { direction: 'sendrecv' });
        if (!audioOnly) {
          setupCtrl(pc.createDataChannel('ctrl'));
          const cam = pc.addTransceiver('video', { direction: 'sendrecv' });
          const scr = pc.addTransceiver('video', { direction: 'sendrecv' });
          const caps = RTCRtpReceiver.getCapabilities('video');
          const h264 = (caps?.codecs ?? []).filter((c) => c.mimeType === 'video/H264' && /packetization-mode=1/.test(c.sdpFmtpLine ?? ''));
          if (h264.length) {
            const prefs = [...h264, ...caps!.codecs.filter((c) => !h264.includes(c))];
            cam.setCodecPreferences(prefs);
            scr.setCodecPreferences(prefs);
          }
        }
        await pc.setLocalDescription(await pc.createOffer());
        st.offerSdp = injectH264 ? withH264(pc.localDescription!.sdp) : pc.localDescription!.sdp;
        send({ type: 'call_invite', to: peer, sdp: st.offerSdp, sdpType: 'offer', name: 'Browser' });
        flushLocalIce();
      };
      w.__hangup = () => {
        send({ type: 'call_end', to: peer });
        st.pc?.close();
      };
      w.__stats = async () => {
        const out = { connection: st.pc ? st.pc.connectionState : 'none', inPackets: 0, inEnergy: 0, outPackets: 0 };
        if (!st.pc || st.pc.connectionState === 'closed') return out;
        (await st.pc.getStats()).forEach((r: any) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            out.inPackets += r.packetsReceived ?? 0;
            out.inEnergy += r.totalAudioEnergy ?? 0;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'audio') out.outPackets += r.packetsSent ?? 0;
        });
        return out;
      };
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket не подключился'));
      });
    },
    { token, peer },
  );
}

const stats = (page: Page) => page.evaluate(() => (window as any).__peer && (window as any).__stats());
const peerState = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__peer;
    return {
      invited: !!p.invite,
      offer: p.offerSdp as string,
      answer: p.answerSdp as string,
      ended: p.ended as string,
      ends: [...p.ends] as string[],
    };
  });

/** Звук в обе стороны: браузер принимает и отправляет RTP, десктоп декодирует тон. */
async function expectTwoWayAudio(page: Page, desk: Desktop) {
  await desk.waitFor('десктоп в звонке', (e) => e.event === 'state' && e.state === 'incall');
  await expect.poll(async () => (await stats(page)).connection, { timeout: 20_000 }).toBe('connected');
  await expect
    .poll(
      async () => {
        const s = await stats(page);
        return s.inPackets > 50 && s.outPackets > 50 && s.inEnergy > 0;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  // 660 Гц браузера на −12 dBFS доходит до десктопа: RMS ≈ 5800 (тишина — 0)
  await desk.waitFor('десктоп слышит браузер', (e) => e.event === 'stats' && e.rx_frames >= 50 && e.rx_rms > 1000);
}

const mLinePorts = (sdp: string, kind: string) => [...sdp.matchAll(new RegExp(`^m=${kind} (\\d+)`, 'gm'))].map((m) => m[1]);

test.describe('звонки десктоп ↔ браузер', () => {
  test('десктоп звонит браузеру: звук в обе стороны, браузер кладёт трубку', async ({ browser, request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installPeer(page, web.token, desktop.id);
    const desk = new Desktop(desktop.token, web.id, 'call');
    try {
      await expect.poll(async () => (await peerState(page)).invited, { timeout: 20_000 }).toBe(true);
      const { offer } = await peerState(page);
      // Offer десктопа не изменился (CALLS.md §3.4), но SSRC теперь случайные
      expect(offer).toMatch(/a=mid:audio[\s\S]*a=mid:video[\s\S]*a=mid:screen/);
      expect(offer).toContain('a=rtpmap:111 opus/48000/2');
      expect(offer).not.toMatch(/a=ssrc:4[234] /);
      await page.evaluate(() => (window as any).__accept());
      await expectTwoWayAudio(page, desk);
      await page.evaluate(() => (window as any).__hangup());
      expect(await desk.exitCode()).toBe(0);
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
      await ctx.close();
    }
  });

  test('браузер звонит десктопу обычным offer\'ом: десктоп подстраивается под mid и PT', async ({ browser, request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installPeer(page, web.token, desktop.id);
    const desk = new Desktop(desktop.token, web.id, 'answer');
    try {
      await desk.waitFor('десктоп подключён', (e) => e.event === 'ws' && e.connected);
      await page.evaluate(() => (window as any).__call());
      await expectTwoWayAudio(page, desk);

      const { offer, answer } = await peerState(page);
      const opusPt = offer.match(/a=rtpmap:(\d+) opus\/48000/)![1];
      expect(answer).toContain(`a=rtpmap:${opusPt} opus/48000`);
      expect(answer).toMatch(/^a=mid:0\r?$/m);
      expect(mLinePorts(answer, 'audio')).toEqual(['9']);
      // Видео-линии принимаются, только если браузер умеет H264 packetization-mode=1
      const h264 = /a=rtpmap:\d+ H264\/90000/.test(offer);
      expect(mLinePorts(answer, 'video')).toEqual(h264 ? ['9', '9'] : ['0', '0']);
      expect(answer).toContain('m=application');

      desk.hangup();
      await expect.poll(async () => (await peerState(page)).ended).toBe('call_end');
      expect(await desk.exitCode()).toBe(0);
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
      await ctx.close();
    }
  });

  test('браузер звонит десктопу только со звуком (без видео и data channel)', async ({ browser, request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installPeer(page, web.token, desktop.id);
    const desk = new Desktop(desktop.token, web.id, 'answer');
    try {
      await desk.waitFor('десктоп подключён', (e) => e.event === 'ws' && e.connected);
      await page.evaluate(() => (window as any).__call(true));
      await expectTwoWayAudio(page, desk);
      const { answer } = await peerState(page);
      expect(mLinePorts(answer, 'video')).toEqual([]);
      await page.evaluate(() => (window as any).__hangup());
      expect(await desk.exitCode()).toBe(0);
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
      await ctx.close();
    }
  });

  test('десктоп выбирает H264 packetization-mode=1 профиля 42e01f из offer\'а', async ({ browser, request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installPeer(page, web.token, desktop.id);
    const desk = new Desktop(desktop.token, web.id, 'answer');
    try {
      await desk.waitFor('десктоп подключён', (e) => e.event === 'ws' && e.connected);
      await page.evaluate(() => (window as any).__call(false, true));
      await expect.poll(async () => (await peerState(page)).answer, { timeout: 20_000 }).not.toBe('');
      const { answer } = await peerState(page);
      const video = answer.split(/(?=^m=)/m).filter((sec) => sec.startsWith('m=video'));
      expect(video).toHaveLength(2);
      for (const sec of video) {
        expect(sec).toMatch(/^m=video 9 \S+ 121\r?$/m); // 42e01f pm=1, а не первый H264 в списке
        expect(sec).toContain('a=rtpmap:121 H264/90000');
        expect(sec).toMatch(/a=fmtp:121 .*profile-level-id=42e01f/);
        expect(sec).toMatch(/a=rtcp-fb:121 goog-remb/);
        expect(sec).toMatch(/a=ssrc:\d+ cname:/);
      }
      await page.evaluate(() => (window as any).__hangup());
      // Ответ браузер не применил, но ICE/DTLS с десктопа может и сойтись — главное, штатный выход
      expect([0, 1]).toContain(await desk.exitCode());
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
      await ctx.close();
    }
  });

  test('битый answer не роняет десктоп: он кладёт трубку и шлёт call_end', async ({ browser, request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installPeer(page, web.token, desktop.id);
    const desk = new Desktop(desktop.token, web.id, 'call');
    try {
      await expect.poll(async () => (await peerState(page)).invited, { timeout: 20_000 }).toBe(true);
      await page.evaluate(() => (window as any).__accept(true));
      // Ждём условия, а не времени: под нагрузкой десктоп может отвечать долго. Его call_end должен дойти,
      // даже если раньше пришёл call_unavailable в ответ на запоздалые rtc_ice браузера
      await desk.waitFor('уведомление о сбое', (e) => e.event === 'notice' && /Не удалось/.test(e.text), 30_000);
      expect(await desk.exitCode()).toBe(1); // штатный выход: звонок не состоялся, процесс не упал
      await expect.poll(async () => (await peerState(page)).ends, { timeout: 20_000 }).toContain('call_end');
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
      await ctx.close();
    }
  });

  test('звонок пользователю не в сети: call_unavailable завершает вызов сразу', async ({ request }) => {
    const desktop = await register(request, 'Десктоп');
    const web = await register(request, 'Браузер');
    await makeFriends(request, desktop, web);
    const desk = new Desktop(desktop.token, web.id, 'call');
    try {
      await desk.waitFor('уведомление «не в сети»', (e) => e.event === 'notice' && /не в сети/.test(e.text));
      expect(await desk.exitCode()).toBe(1);
    } finally {
      desk.kill();
      await test.info().attach('desktop.log', { body: desk.log() });
    }
  });
});
