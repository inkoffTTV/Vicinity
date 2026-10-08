import { useCallback, useEffect, useState } from 'react';
import { setAppBadge } from './lib/pwa';
import { useInvite } from './lib/router';
import { useSearch } from './lib/search';
import { useShortcuts } from './lib/shortcuts';
import { useStore } from './lib/store';
import { attentionCount } from './lib/unread';
import { useVoice } from './lib/voice';
import { Login } from './components/Login';
import { ServerRail } from './components/ServerRail';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { Friends } from './components/Friends';
import { GroupPanel } from './components/GroupPanel';
import { MemberList } from './components/MemberList';
import { ProfileModal } from './components/ProfileModal';
import { Settings } from './components/Settings';
import { Toasts } from './components/Toasts';
import { UserMenu } from './components/UserMenu';
import { IncomingCall } from './components/IncomingCall';
import { InviteCard } from './components/InviteCard';
import { CallOverlay } from './components/CallOverlay';
import { QuickSwitcher } from './components/QuickSwitcher';
import { SearchPanel } from './components/Search';

export default function App() {
  const booting = useStore((s) => s.booting);
  const unreachable = useStore((s) => s.unreachable);
  const me = useStore((s) => s.me);
  const boot = useStore((s) => s.boot);
  const view = useStore((s) => s.view);
  const profileUserId = useStore((s) => s.profileUserId);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const inVoice = useVoice((s) => s.channelId !== null);
  const searchOpen = useSearch((s) => s.open);
  const inviteCode = useInvite((s) => s.code);
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
  useEffect(() => setNavOpen(false), [view]);

  // Счётчик во вкладке браузера и на значке приложения: личные сообщения и упоминания
  const unreadTotal = useStore(attentionCount);
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Vicinity` : 'Vicinity';
    setAppBadge(unreadTotal);
  }, [unreadTotal]);

  if (booting) return <div className="splash">Vicinity</div>;
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
      <div className="nav">
        <ServerRail />
        <Sidebar />
      </div>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        {view.kind === 'friends' ? (
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
      ) : view.kind === 'server' && membersOpen ? (
        <MemberList serverId={view.serverId} />
      ) : (
        view.kind === 'group' && membersOpen && <GroupPanel key={view.channelId} channelId={view.channelId} />
      )}
      {profileUserId !== null && <ProfileModal userId={profileUserId} />}
      {settingsOpen && <Settings />}
      {inviteCode && <InviteCard code={inviteCode} />}
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
