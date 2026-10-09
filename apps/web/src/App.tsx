// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Notification as Note, ServerInfo } from '@ocpc/shared';
import { api, setUnauthorizedHandler } from './lib/api';
import { loadBootstrap, useStore } from './lib/store';
import { connect, disconnect } from './lib/realtime';
import {
  registerServiceWorker,
  showDesktopNotification,
  subscribePush,
  syncTitle,
  notificationPermission,
} from './lib/notify';
import { t } from './lib/i18n';
import { Sidebar, useSidebarOrder } from './components/Sidebar';
import { QuickSwitcher } from './components/QuickSwitcher';
import { ConfirmHost, Spinner, useHotkey } from './components/ui';
import { ShortcutsModal } from './components/modals';
import { ChannelView } from './pages/ChannelView';
import {
  ActivityPage,
  BrowsePage,
  PeoplePage,
  SavedPage,
  SearchPage,
  ThreadsPage,
} from './pages/lists';
import { JoinPage, LoginPage, ResetPage, SetupPage } from './pages/auth';
import { SettingsPage } from './settings/SettingsPage';
import { AdminPage } from './admin/AdminPage';
import { CallLayer } from './calls/CallLayer';
import { Toasts } from './components/Toasts';
import { TwoFactorGate } from './settings/TwoFactorGate';

type Phase = 'loading' | 'setup' | 'anon' | 'ready' | 'error';

function applyTheme(theme: string, density: string) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.density = density;
}

function Home() {
  const { flat } = useSidebarOrder();
  let last: string | null = null;
  try {
    last = localStorage.getItem('ocpc.lastChannel');
  } catch {
    /* ignore */
  }
  const channels = useStore((s) => s.channels);
  const target =
    last && channels[last]
      ? last
      : (flat.find((c) => c.kind === 'public' && c.name === 'general') ?? flat[0])?.id;
  return target ? <Navigate to={`/c/${target}`} replace /> : <main className="main" />;
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [switcher, setSwitcher] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const connected = useStore((s) => s.connected || !s.everConnected);
  const me = useStore((s) => s.me)!;
  const { flat } = useSidebarOrder();

  // Theme follows preferences (and the OS when set to "system").
  useEffect(() => {
    applyTheme(me.preferences.theme, me.preferences.density);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme(me.preferences.theme, me.preferences.density);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [me.preferences.theme, me.preferences.density]);

  // Title + badge.
  useEffect(() => useStore.subscribe(syncTitle), []);
  useEffect(syncTitle, [location.pathname]);

  // Desktop notifications for activity.
  useEffect(() => {
    const onNote = (e: Event) => showDesktopNotification((e as CustomEvent<Note>).detail, navigate);
    const onNav = (e: Event) => navigate((e as CustomEvent<string>).detail);
    const toggle = () => setNavOpen((v) => !v);
    const close = () => setNavOpen(false);
    window.addEventListener('ocpc:notification', onNote);
    window.addEventListener('ocpc:navigate', onNav);
    window.addEventListener('ocpc:toggle-nav', toggle);
    window.addEventListener('ocpc:close-nav', close);
    return () => {
      window.removeEventListener('ocpc:notification', onNote);
      window.removeEventListener('ocpc:navigate', onNav);
      window.removeEventListener('ocpc:toggle-nav', toggle);
      window.removeEventListener('ocpc:close-nav', close);
    };
  }, [navigate]);

  useEffect(() => setNavOpen(false), [location.pathname]);

  // Window focus drives read state.
  useEffect(() => {
    const onFocus = () => useStore.setState({ focused: true });
    const onBlur = () => useStore.setState({ focused: false });
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Keyboard shortcuts.
  useHotkey('mod+k', (e) => (e.preventDefault(), setSwitcher(true)));
  useHotkey('mod+shift+f', (e) => (e.preventDefault(), navigate('/search')), [navigate]);
  useHotkey('mod+shift+t', (e) => (e.preventDefault(), navigate('/threads')), [navigate]);
  useHotkey('mod+shift+m', (e) => (e.preventDefault(), navigate('/activity')), [navigate]);
  const step = useCallback(
    (dir: 1 | -1, unreadOnly: boolean) => {
      const current = location.pathname.startsWith('/c/') ? location.pathname.slice(3) : null;
      const list = flat;
      if (!list.length) return;
      let i = Math.max(
        -1,
        list.findIndex((c) => c.id === current),
      );
      for (let n = 0; n < list.length; n++) {
        i = (i + dir + list.length) % list.length;
        const c = list[i]!;
        if (!unreadOnly || c.unreadCount > 0) return navigate(`/c/${c.id}`);
      }
    },
    [flat, location.pathname, navigate],
  );
  useHotkey('alt+arrowdown', (e) => (e.preventDefault(), step(1, false)), [step]);
  useHotkey('alt+arrowup', (e) => (e.preventDefault(), step(-1, false)), [step]);
  useHotkey('alt+shift+arrowdown', (e) => (e.preventDefault(), step(1, true)), [step]);
  useHotkey('alt+shift+arrowup', (e) => (e.preventDefault(), step(-1, true)), [step]);
  useHotkey('mod+shift+a', (e) => (e.preventDefault(), step(1, true)), [step]);
  useHotkey('shift+escape', async () => {
    const chans = Object.values(useStore.getState().channels).filter((c) => c.unreadCount > 0);
    for (const c of chans) {
      if (c.lastMessageAt) {
        const page = await api
          .get<{ messages: { id: string }[] }>(`/channels/${c.id}/messages?limit=1`)
          .catch(() => null);
        const last = page?.messages[0]?.id;
        if (last) await api.post(`/channels/${c.id}/read`, { messageId: last }).catch(() => {});
      }
    }
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setShortcuts(true);
      }
      // Typing a printable key anywhere focuses the composer.
      if (
        !typing &&
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key !== '?' &&
        !document.querySelector('.overlay, .popover')
      ) {
        const ta = document.querySelector<HTMLTextAreaElement>('.main .composer textarea');
        ta?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar onSearch={() => setSwitcher(true)} />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/c/:channelId" element={<ChannelView />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!connected && (
        <div
          className="offline-banner"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 400 }}
          role="status"
        >
          {t('Reconnecting…')}
        </div>
      )}
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
      <CallLayer />
    </div>
  );
}

function Root() {
  const [phase, setPhase] = useState<Phase>('loading');
  const navigate = useNavigate();
  const location = useLocation();
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);

  const start = useCallback(async () => {
    try {
      const info = await api.get<ServerInfo>('/info', { quiet401: true });
      useStore.setState({ info });
      if (info.setupRequired) return setPhase('setup');
      try {
        await loadBootstrap();
      } catch {
        return setPhase('anon');
      }
      setPhase('ready');
      connect();
      registerServiceWorker().then(() => {
        if (notificationPermission() === 'granted') subscribePush().catch(() => {});
      });
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      disconnect();
      useStore.setState({ me: null });
      setPhase('anon');
    });
    start();
  }, [start]);

  const signedIn = () => {
    setPhase('loading');
    const next = new URLSearchParams(location.search).get('next');
    start().then(() =>
      navigate(
        next && next.startsWith('/')
          ? next
          : location.pathname.startsWith('/join') || location.pathname === '/login'
            ? '/'
            : location.pathname,
        { replace: true },
      ),
    );
  };

  if (phase === 'loading') {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spinner size={28} />
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>{t("Can't reach the server")}</h1>
          <p className="muted">{t('Check your connection and try again.')}</p>
          <button className="btn btn-primary" onClick={() => (setPhase('loading'), start())}>
            {t('Retry')}
          </button>
        </div>
      </div>
    );
  }
  if (phase === 'setup') return <SetupPage onDone={signedIn} />;
  if (phase === 'anon') {
    return (
      <Routes>
        <Route path="/join/:code" element={<JoinPage onDone={signedIn} />} />
        <Route path="/reset/:token" element={<ResetPage />} />
        <Route path="/login" element={<LoginPage onDone={signedIn} />} />
        <Route
          path="*"
          element={
            <Navigate
              to={`/login${location.pathname !== '/' ? `?next=${encodeURIComponent(location.pathname + location.search + location.hash)}` : ''}`}
              replace
            />
          }
        />
      </Routes>
    );
  }
  if (location.pathname.startsWith('/join/') || location.pathname === '/login')
    return <Navigate to="/" replace />;
  // Organizations can require two-factor authentication.
  if (settings?.require2fa && me && !me.totpEnabled && !me.isBot) return <TwoFactorGate />;
  return <Shell />;
}

export function App() {
  return (
    <BrowserRouter>
      <Root />
      <ConfirmHost />
      <Toasts />
    </BrowserRouter>
  );
}
