import { Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useCall } from '../lib/call';
import { HTTPS_REQUIRED, mediaAvailable } from '../lib/media';
import { Avatar } from './Avatar';
import { usePeerAvatar } from './CallOverlay';
import { Icon } from './Icon';

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
        <div className="muted small call-banner-status">
          {secure ? (
            <>
              <Icon icon={PhoneIncoming} size={14} anim="ring" className="always" /> Входящий звонок…
            </>
          ) : (
            HTTPS_REQUIRED
          )}
        </div>
      </div>
      <button className="btn ok call-banner-btn" onClick={() => void accept()} disabled={!secure} aria-label="Принять">
        <Icon icon={Phone} size={20} anim="ring" className="always" />
        <span>Принять</span>
      </button>
      <button className="btn danger call-banner-btn" onClick={decline} aria-label="Отклонить">
        <Icon icon={PhoneOff} size={20} />
        <span>Отклонить</span>
      </button>
    </div>
  );
}
