import { useCallback, useEffect, useState } from 'react';
import { DesktopUpdateBanner } from './components/DesktopUpdate';
import { ActivityFrame, ActivityInvites } from './components/Activities';
import { useAppearance } from './lib/prefs';
import { setAppBadge } from './lib/pwa';
import { useGift, useInvite } from './lib/router';
import { useSearch } from './lib/search';
import { useShortcuts } from './lib/shortcuts';
import { useStore } from './lib/store';
import { attentionCount } from './lib/unread';
import { useVoice } from './lib/voice';
import { useVoiceVideo } from './lib/voiceVideo';
import { Login } from './components/Login';
import { ServerRail } from './components/ServerRail';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { Friends } from './components/Friends';
import { Home } from './components/Home';
import { GroupPanel } from './components/GroupPanel';
import { MemberList } from './components/MemberList';
import { ProfileModal } from './components/ProfileModal';
import { Settings } from './components/Settings';
import { Toasts } from './components/Toasts';
import { UserMenu } from './components/UserMenu';
import { IncomingCall } from './components/IncomingCall';
import { InviteCard } from './components/InviteCard';
import { GiftCard } from './components/GiftCard';
import { CallOverlay } from './components/CallOverlay';
import { VoiceStage } from './components/VoiceStage';
import { QuickSwitcher } from './components/QuickSwitcher';
import { SearchPanel } from './components/Search';
import { ProfileStudio, useProfileStudio } from './components/profile/ProfileStudio';
import { OverlayView } from './components/Overlay';

// Оверлей для игр: ПК-приложение открывает этот адрес прозрачным окном поверх всего
const OVERLAY = location.pathname === '/overlay';

export default function App() {
  const booting = useStore((s) => s.booting);
  const unreachable = useStore((s) => s.unreachable);
  const me = useStore((s) => s.me);
  const boot = useStore((s) => s.boot);
  const view = useStore((s) => s.view);
  const profileUserId = useStore((s) => s.profileUserId);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const studioOpen = useProfileStudio((s) => s.open);
  const inVoice = useVoice((s) => s.channelId !== null);
  const stageOpen = useVoiceVideo((s) => s.stageOpen);
  const searchOpen = useSearch((s) => s.open);
  const inviteCode = useInvite((s) => s.code);
  const giftCode = useGift((s) => s.code);
  const [navOpen, setNavOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => window.innerWidth > 1100);
  const [switcher, setSwitcher] = useState(false);
  const closeSwitcher = useCallback(() => setSwitcher(false), []);

  useShortcuts({
    toggleSwitcher: () => setSwitcher((v) => !v && !!useStore.getState().me),
    closePanel: () => {
      if (navOpen) setNavOpen(false);
      // Участники поверх ленты (узкий экран) — закрыть; на широком это постоянная колонка
      else if (membersOpen && window.innerWidth <= 1100) setMembersOpen(false);
    },
  });

  useEffect(() => {
    void boot();
  }, [boot]);

  // На мобильном — закрывать меню при переходе
  useEffect(() => setNavOpen(false), [view, stageOpen]);

  // «Тема по умолчанию на серверах»: на сервере можно показывать стандартную тему вместо своей
  const inServer = !!me && view.kind === 'server';
  useEffect(() => useAppearance.getState().setInServer(inServer), [inServer]);

  // Счётчик во вкладке браузера и на значке приложения: личные сообщения и упоминания
  const unreadTotal = useStore(attentionCount);
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Vicinity` : 'Vicinity';
    setAppBadge(unreadTotal);
  }, [unreadTotal]);

  if (booting) return OVERLAY ? null : <div className="splash">Vicinity</div>;
  if (OVERLAY) return me ? <OverlayView /> : null;
  if (!me && unreachable) return <Unreachable />;
  if (!me)
    return (
      <>
        <Login />
        <Toasts />
      </>
    );

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}${inVoice ? ' in-voice' : ''}`}>
      <div className="app-bg" aria-hidden="true" />
      <DesktopUpdateBanner />
      <ActivityFrame />
      <ActivityInvites />
      <div className="nav">
        <ServerRail />
        <Sidebar />
      </div>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        {stageOpen && inVoice ? (
          <VoiceStage onMenu={() => setNavOpen(true)} />
        ) : view.kind === 'home' ? (
          <Home onMenu={() => setNavOpen(true)} />
        ) : view.kind === 'friends' ? (
          <Friends onMenu={() => setNavOpen(true)} />
        ) : (
          <Chat
            onMenu={() => setNavOpen(true)}
            membersOpen={membersOpen}
            onToggleMembers={() => setMembersOpen((v) => !v)}
          />
        )}
      </main>
      {searchOpen ? (
        <SearchPanel />
      ) : stageOpen && inVoice ? null : view.kind === 'server' && membersOpen ? (
        <MemberList serverId={view.serverId} />
      ) : (
        view.kind === 'group' && membersOpen && <GroupPanel key={view.channelId} channelId={view.channelId} />
      )}
      {profileUserId !== null && <ProfileModal userId={profileUserId} />}
      {settingsOpen && <Settings />}
      {studioOpen && <ProfileStudio />}
      {inviteCode && <InviteCard code={inviteCode} />}
      {giftCode && <GiftCard code={giftCode} />}
      {switcher && <QuickSwitcher onClose={closeSwitcher} />}
      <UserMenu />
      <CallOverlay />
      <IncomingCall />
      <Toasts />
    </div>
  );
}

// Сессия сохранена, но сервер не отвечает (нет сети, перезапуск за nginx) — ждём, а не выходим
function Unreachable() {
  const retryBoot = useStore((s) => s.retryBoot);
  const logout = useStore((s) => s.logout);
  return (
    <div className="splash unreachable" role="alert">
      <div className="stack center">
        <strong>Нет связи с сервером</strong>
        <span className="muted small">Повторяем попытку подключения…</span>
        <div className="stack-row">
          <button className="btn primary" onClick={retryBoot}>
            Повторить сейчас
          </button>
          <button className="btn" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
