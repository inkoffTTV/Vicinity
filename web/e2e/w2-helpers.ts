import { expect } from '@playwright/test';
import { User } from './helpers';

// Общие шаги для w2-*.spec.ts (управление серверами и беседами, настройки, адреса, PWA).

/** Открыть настройки открытого сервера из меню в его заголовке */
export async function openServerSettings(u: User, item: 'Настройки сервера' | 'Пригласить людей' = 'Настройки сервера') {
  await u.page.locator('.side-head').click();
  await u.page.locator('.dropdown button', { hasText: item }).click();
  await expect(u.page.locator('.modal.settings-modal')).toBeVisible();
}

export const settingsTab = (u: User, name: string) => u.page.locator('.settings-tabs').getByRole('tab', { name });

/** Подтвердить действие в окне подтверждения (верхнее окно), при необходимости введя текст */
export async function confirmDialog(u: User, action: string, typed?: string) {
  const dialog = u.page.locator('.modal').last();
  if (typed !== undefined) await dialog.locator('input').fill(typed);
  await dialog.getByRole('button', { name: action, exact: true }).click();
}

/** id сервера, открытого на экране, — из адреса /channels/<serverId>/<channelId> */
export const openServerId = (u: User) => Number(new URL(u.page.url()).pathname.split('/')[2]);
