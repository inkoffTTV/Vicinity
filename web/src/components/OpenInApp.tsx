import { AppWindow } from 'lucide-react';
import { android, offerAndroidApp } from '../lib/android';
import { desktop, offerDesktopApp } from '../lib/desktop';
import { Icon } from './Icon';

/**
 * Ссылку открыли в браузере — адрес, который откроет её в установленном приложении:
 * Windows — vicinity://… (приложение 1.2.0+), Android — intent:// (без приложения браузер останется на сайте).
 * null — уже в приложении или под эту систему приложения нет.
 */
export function appLink(path: string): string | null {
  if (desktop || android) return null;
  const clean = path.replace(/^\/+/, '');
  if (offerAndroidApp)
    return `intent://${clean}#Intent;scheme=vicinity;package=app.vicinity.android;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
  if (offerDesktopApp) return `vicinity://${clean}`;
  return null;
}

/** Кнопка «Открыть в приложении» для ссылки, открытой в браузере */
export function OpenInApp({ path }: { path: string }) {
  const href = appLink(path);
  if (!href) return null;
  return (
    <a className="btn small invite-card-app" href={href}>
      <Icon icon={AppWindow} size={16} />
      Открыть в приложении Vicinity
    </a>
  );
}
