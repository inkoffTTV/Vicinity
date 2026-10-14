import { Download, Smartphone, SquarePlus, Share } from 'lucide-react';
import { useState } from 'react';
import { ANDROID_APK, offerAndroidApp, offerIosInstall } from '../lib/android';
import { offerDesktopApp, WINDOWS_INSTALLER } from '../lib/desktop';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Шаги установки на iPhone/iPad: приложение — это сайт на экране «Домой» */
export function IosInstallModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Vicinity на iPhone" onClose={onClose} className="ios-install">
      <ol className="ios-steps">
        <li>
          Откройте этот сайт в <strong>Safari</strong>.
        </li>
        <li>
          Нажмите <Icon icon={Share} size={18} className="ios-step-icon" /> <strong>«Поделиться»</strong> внизу экрана (на iPad — вверху).
        </li>
        <li>
          Выберите <Icon icon={SquarePlus} size={18} className="ios-step-icon" /> <strong>«На экран „Домой“»</strong> и нажмите{' '}
          <strong>«Добавить»</strong>.
        </li>
        <li>Запускайте Vicinity со значка на экране — он открывается на весь экран, как обычное приложение.</li>
      </ol>
      <p className="muted small">
        Так приложение работает со звонками, камерой и микрофоном на iOS 16.4 и новее. Уведомления о сообщениях приходят, пока Vicinity
        открыт или недавно свёрнут.
      </p>
      <div className="row-end">
        <button type="button" className="btn primary" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Modal>
  );
}

/** Ссылки «Скачать приложение» на экране входа: Windows, Android или установка на iPhone */
export function AuthAppLinks() {
  const [ios, setIos] = useState(false);
  return (
    <>
      {offerDesktopApp && (
        <a className="auth-download" href={WINDOWS_INSTALLER} download>
          <Icon icon={Download} size={18} anim="bounce" />
          <span>
            <strong>Скачать для Windows</strong>
            <span>Приложение с уведомлениями и показом экрана</span>
          </span>
        </a>
      )}
      {offerAndroidApp && (
        <a className="auth-download" href={ANDROID_APK} download>
          <Icon icon={Smartphone} size={18} anim="bounce" />
          <span>
            <strong>Скачать для Android</strong>
            <span>Приложение с уведомлениями и звонками в фоне</span>
          </span>
        </a>
      )}
      {offerIosInstall && (
        <button type="button" className="auth-download" onClick={() => setIos(true)}>
          <Icon icon={Smartphone} size={18} anim="bounce" />
          <span>
            <strong>Установить на iPhone</strong>
            <span>Значок на экране «Домой» за пару касаний</span>
          </span>
        </button>
      )}
      {ios && <IosInstallModal onClose={() => setIos(false)} />}
    </>
  );
}

/** То же в настройках, внизу меню разделов */
export function SettingsAppLinks() {
  const [ios, setIos] = useState(false);
  return (
    <>
      {offerDesktopApp && (
        <a className="settings-download" href={WINDOWS_INSTALLER} download>
          <Icon icon={Download} size={16} />
          Приложение для Windows
        </a>
      )}
      {offerAndroidApp && (
        <a className="settings-download" href={ANDROID_APK} download>
          <Icon icon={Smartphone} size={16} />
          Приложение для Android
        </a>
      )}
      {offerIosInstall && (
        <button type="button" className="settings-download" onClick={() => setIos(true)}>
          <Icon icon={Smartphone} size={16} />
          Установить на iPhone
        </button>
      )}
      {ios && <IosInstallModal onClose={() => setIos(false)} />}
    </>
  );
}
