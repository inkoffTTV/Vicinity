// ПК-приложение (desktop/): окно Electron с этим же веб-клиентом. Мост из desktop/src/preload.js.
import { useEffect, useState } from 'react';

interface DesktopBridge {
  platform: string;
  installUpdate: () => void;
  retry: () => void;
  /** С версии 1.0.1: значок окна, трея и ярлыков (png 256×256; null — исходный) */
  setIcon?: (id: string, png: string | null) => void;
}

export const desktop: DesktopBridge | undefined = (window as unknown as { vicinityDesktop?: DesktopBridge }).vicinityDesktop;

/** Установщик для Windows — на этом же сервере (deploy/downloads → /download/) */
export const WINDOWS_INSTALLER = '/download/Vicinity-Setup.exe';

/** Предлагать скачать приложение: Windows в браузере, а не внутри самого приложения */
export const offerDesktopApp = !desktop && /Windows NT/i.test(navigator.userAgent);

/** Приложение скачало обновление — можно перезапустить и поставить */
export function useDesktopUpdate(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const on = () => setReady(true);
    window.addEventListener('vicinity-desktop-update', on);
    return () => window.removeEventListener('vicinity-desktop-update', on);
  }, []);
  return ready;
}
