import { useStore, VOICE_UNSUPPORTED } from '../lib/store';

export function IncomingCall() {
  const call = useStore((s) => s.incomingCall);
  const reject = useStore((s) => s.rejectCall);
  if (!call) return null;
  return (
    <div className="call-banner">
      <div>
        <strong>📞 Входящий звонок: {call.name}</strong>
        <div className="muted small">{VOICE_UNSUPPORTED}</div>
      </div>
      <button className="btn danger" onClick={reject}>
        Отклонить
      </button>
    </div>
  );
}
