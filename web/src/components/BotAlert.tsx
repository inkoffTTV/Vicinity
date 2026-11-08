import { ExternalLink } from 'lucide-react';
import { useBots } from '../lib/bots';
import { Icon } from './Icon';
import { Modal } from './Modal';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'ссылку';
  }
}

/** Заметный ответ бота на нажатие кнопки (answerCallbackQuery с show_alert, docs/API.md §21) */
export function BotAlert() {
  const alert = useBots((s) => s.alert);
  const close = useBots((s) => s.closeAlert);
  if (!alert) return null;
  return (
    <Modal title="Сообщение бота" onClose={close} className="bot-alert">
      <p className="bot-alert-text">{alert.text}</p>
      {alert.url ? (
        <div className="row end">
          <button type="button" className="btn" onClick={close}>
            Закрыть
          </button>
          {/* Браузер не открыл ссылку сам — открывается нажатием, в новой вкладке */}
          <a className="btn primary" href={alert.url} target="_blank" rel="noopener noreferrer" autoFocus onClick={close}>
            <Icon icon={ExternalLink} size={16} />
            Открыть {hostOf(alert.url)}
          </a>
        </div>
      ) : (
        <div className="row end">
          <button type="button" className="btn primary" autoFocus onClick={close}>
            Понятно
          </button>
        </div>
      )}
    </Modal>
  );
}
