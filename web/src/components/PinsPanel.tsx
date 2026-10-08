import { useEffect, useState } from 'react';
import { parseTs } from '../lib/api';
import { attachmentName } from '../lib/files';
import { canManagePins, usePins } from '../lib/pins';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { formatTime } from './Message';
import { Popover } from './Popover';

/** Закреплённые сообщения канала: переход к сообщению, открепление (кому можно) */
export function PinsPanel({ channelId, anchor, onClose }: { channelId: number; anchor: HTMLElement; onClose: () => void }) {
  const pins = usePins((s) => s.byChannel[channelId]);
  const unpin = usePins((s) => s.unpin);
  const jumpTo = useStore((s) => s.jumpTo);
  const [loaded, setLoaded] = useState(false);
  const canPin = canManagePins(channelId);

  useEffect(() => {
    let alive = true;
    void usePins
      .getState()
      .load(channelId)
      .then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [channelId]);

  return (
    <Popover anchor={anchor} onClose={onClose} className="pins-panel" role="dialog" label="Закреплённые сообщения">
      <div className="popover-head">
        <strong>📌 Закреплённые сообщения</strong>
        <button className="icon-btn small" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <div className="popover-body">
        {!pins ? (
          <div className="popover-empty muted">{loaded ? 'Не удалось загрузить закреплённые сообщения' : 'Загрузка…'}</div>
        ) : pins.length === 0 ? (
          <div className="popover-empty muted">
            В этом канале пока ничего не закреплено.
            {canPin && ' Наведите на сообщение и нажмите 📌.'}
          </div>
        ) : (
          pins.map((p) => (
            <div key={p.id} className="pin-item">
              <Avatar name={p.author_name} src={p.author_avatar} id={p.author_id} size={32} />
              <div className="grow">
                <div className="pin-meta">
                  <strong className="ellipsis">{p.author_name}</strong>
                  <span className="muted small">{formatTime(parseTs(p.created_at))}</span>
                </div>
                {p.text && (
                  <div className="pin-text">
                    <Markdown text={p.text} />
                  </div>
                )}
                {p.attachment && <div className="muted small ellipsis">📎 {attachmentName(p.attachment_name, p.attachment)}</div>}
              </div>
              <div className="pin-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    onClose();
                    void jumpTo(channelId, p.id);
                  }}
                >
                  Перейти
                </button>
                {canPin && (
                  <button
                    className="icon-btn small"
                    title="Открепить"
                    aria-label={`Открепить сообщение ${p.author_name}`}
                    onClick={() => void unpin(channelId, p.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
