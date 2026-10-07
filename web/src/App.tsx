import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { Login } from './components/Login';
import { ServerRail } from './components/ServerRail';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { Friends } from './components/Friends';
import { MemberList } from './components/MemberList';
import { ProfileModal } from './components/ProfileModal';
import { Settings } from './components/Settings';
import { Toasts } from './components/Toasts';
import { IncomingCall } from './components/IncomingCall';

export default function App() {
  const booting = useStore((s) => s.booting);
  const me = useStore((s) => s.me);
  const boot = useStore((s) => s.boot);
  const view = useStore((s) => s.view);
  const profileUserId = useStore((s) => s.profileUserId);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const [navOpen, setNavOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => window.innerWidth > 1100);

  useEffect(() => {
    void boot();
  }, [boot]);

  // На мобильном — закрывать меню при переходе
  useEffect(() => setNavOpen(false), [view]);

  // Счётчик непрочитанного во вкладке браузера
  const unreadTotal = useStore((s) => Object.values(s.unread).reduce((a, b) => a + b, 0));
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Vicinity` : 'Vicinity';
  }, [unreadTotal]);

  if (booting) return <div className="splash">Vicinity</div>;
  if (!me)
    return (
      <>
        <Login />
        <Toasts />
      </>
    );

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
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
      {view.kind === 'server' && membersOpen && <MemberList serverId={view.serverId} />}
      {profileUserId !== null && <ProfileModal userId={profileUserId} />}
      {settingsOpen && <Settings />}
      <IncomingCall />
      <Toasts />
    </div>
  );
}
