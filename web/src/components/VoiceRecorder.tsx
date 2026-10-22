import { Mic, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mediaError, useMediaPrefs } from '../lib/media';
import { useStore } from '../lib/store';
import { formatClock, Recorder, Recording, startRecording, VOICE_MAX_SEC } from '../lib/voiceNote';
import { Icon } from './Icon';

interface Props {
  onDone: (r: Recording) => void;
  onCancel: () => void;
}

/** Строка записи голосового: таймер, отмена, отправка. Запись идёт, пока компонент показан */
export function VoiceRecorder({ onDone, onCancel }: Props) {
  const toast = useStore((s) => s.toast);
  const inputId = useMediaPrefs((s) => s.inputId);
  const rec = useRef<Recorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const finish = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    startRecording(inputId).then(
      (r) => {
        if (!alive) return r.cancel();
        rec.current = r;
        timer = window.setInterval(() => {
          const sec = (Date.now() - r.startedAt) / 1000;
          setElapsed(sec);
          if (sec >= VOICE_MAX_SEC) finish.current?.();
        }, 200);
      },
      (e) => {
        if (!alive) return;
        toast(mediaError(e), 'error');
        onCancel();
      },
    );
    return () => {
      alive = false;
      window.clearInterval(timer);
      rec.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    const r = rec.current;
    if (!r || stopping) return;
    setStopping(true);
    const out = await r.stop();
    rec.current = null;
    if (out) onDone(out);
    else {
      toast('Слишком короткая запись');
      onCancel();
    }
  };
  finish.current = () => void stop();

  const cancel = () => {
    rec.current?.cancel();
    rec.current = null;
    onCancel();
  };

  return (
    <div className="composer-rec" role="group" aria-label="Запись голосового сообщения">
      <button className="icon-btn" onClick={cancel} title="Отменить запись" aria-label="Отменить запись">
        <Icon icon={X} size={22} />
      </button>
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-time" aria-live="polite">
        {formatClock(elapsed)}
      </span>
      <span className="muted small grow ellipsis">
        <Icon icon={Mic} size={14} className="inline-ico" />
        Идёт запись
      </span>
      <button className="icon-btn send-btn" onClick={() => void stop()} disabled={stopping} title="Отправить" aria-label="Отправить голосовое">
        <Icon icon={SendHorizontal} className="anim-nudge" size={24} />
      </button>
    </div>
  );
}
