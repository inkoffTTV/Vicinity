import { Gamepad2, Rocket, Users } from 'lucide-react';
import { useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Активность — игра или занятие, в которое играют вместе прямо в звонке */
export interface Activity {
  id: string;
  name: string;
  description: string;
  /** Сколько человек: «2–8» */
  players: string;
}

// Список активностей. Пока пуст — игры добавятся сюда (каждая — своя страница в iframe звонка)
export const ACTIVITIES: Activity[] = [];

/** Кнопка «Активности» в панели голосового канала и звонка */
export function ActivitiesButton({ btnClass, size = 22 }: { btnClass: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={btnClass} title="Активности" aria-label="Активности" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon icon={Rocket} anim="bounce" size={size} />
      </button>
      {open && <ActivitiesDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ActivitiesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Активности" onClose={onClose} className="activities-modal">
      <div className="stack">
        <p className="muted">Игры и занятия, в которые можно играть вместе, не выходя из звонка.</p>
        {ACTIVITIES.length ? (
          <div className="act-grid">
            {ACTIVITIES.map((a) => (
              <button key={a.id} type="button" className="act-card">
                <span className="act-cover">
                  <Icon icon={Gamepad2} size={28} />
                </span>
                <strong>{a.name}</strong>
                <span className="muted small">{a.description}</span>
                <span className="act-players muted small">
                  <Icon icon={Users} size={12} /> {a.players}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="act-empty">
            <span className="act-empty-icon" aria-hidden="true">
              <Icon icon={Gamepad2} size={28} />
            </span>
            <strong>Скоро здесь появятся игры</strong>
            <span className="muted small">Первые активности уже готовятся. Когда они выйдут, их можно будет запустить для всех участников звонка одной кнопкой.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
