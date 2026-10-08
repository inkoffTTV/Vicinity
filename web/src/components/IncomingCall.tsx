import { useCall } from '../lib/call';
import { HTTPS_REQUIRED, mediaAvailable } from '../lib/media';
import { Avatar } from './Avatar';
import { usePeerAvatar } from './CallOverlay';

export function IncomingCall() {
  const phase = useCall((s) => s.phase);
  const peerId = useCall((s) => s.peerId);
  const peerName = useCall((s) => s.peerName);
  const accept = useCall((s) => s.accept);
  const decline = useCall((s) => s.decline);
  const avatar = usePeerAvatar(peerId);
  if (phase !== 'incoming') return null;
  // Без https браузер не даст микрофон — принять нельзя, объясняем почему
  const secure = mediaAvailable();
  return (
    <div className="call-banner" role="alertdialog" aria-label={`Входящий звонок: ${peerName}`}>
      <span className="call-banner-avatar">
        <Avatar name={peerName} src={avatar} id={peerId} size={44} />
      </span>
      <div className="grow">
        <strong className="ellipsis">{peerName}</strong>
        <div className="muted small">{secure ? '📞 Входящий звонок…' : HTTPS_REQUIRED}</div>
      </div>
      <button className="btn ok" onClick={() => void accept()} disabled={!secure}>
        Принять
      </button>
      <button className="btn danger" onClick={decline}>
        Отклонить
      </button>
    </div>
  );
}
