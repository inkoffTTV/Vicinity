// Поиск по сообщениям (GET /search, docs/API.md §5): в канале, на сервере или во всех доступных чатах.
import { create } from 'zustand';
import { api, ApiError, SearchResult } from './api';
import { activeChannelId, useStore, View } from './store';

/** Где искать: открытый канал, его сервер или всё сразу */
export type SearchScope = 'channel' | 'server' | 'all';

interface State {
  open: boolean;
  query: string;
  scope: SearchScope;
  results: SearchResult[] | null;
  loading: boolean;
  error: string;
  /** Запрос, по которому получены results (для подсветки) */
  shown: string;
  setQuery: (q: string) => void;
  setScope: (scope: SearchScope) => void;
  run: () => Promise<void>;
  close: () => void;
}

/** Какие области поиска имеют смысл на этом экране */
export function scopesFor(v: View): SearchScope[] {
  if (v.kind === 'server') return v.channelId ? ['channel', 'server', 'all'] : ['server', 'all'];
  if (v.kind === 'dm' || v.kind === 'group') return ['channel', 'all'];
  return ['all'];
}

let seq = 0;

export const useSearch = create<State>((set, get) => ({
  open: false,
  query: '',
  scope: 'channel',
  results: null,
  loading: false,
  error: '',
  shown: '',
  setQuery: (query) => set({ query }),
  setScope: (scope) => {
    set({ scope });
    if (get().open && get().query.trim().length >= 2) void get().run();
  },
  run: async () => {
    const q = get().query.trim();
    if (q.length < 2) return set({ open: true, results: null, error: 'Введите хотя бы 2 символа', shown: '' });
    const v = useStore.getState().view;
    const scopes = scopesFor(v);
    const scope = scopes.includes(get().scope) ? get().scope : scopes[0];
    const ch = activeChannelId(v);
    const id = ++seq;
    set({ open: true, loading: true, error: '', scope });
    try {
      const results = await api.search(q, {
        channel_id: scope === 'channel' && ch ? ch : undefined,
        server_id: scope === 'server' && v.kind === 'server' ? v.serverId : undefined,
      });
      // Ответ на прежний запрос, пришедший позже нового, не показываем
      if (id === seq) set({ results, loading: false, shown: q });
    } catch (e) {
      if (id === seq) set({ loading: false, results: null, error: e instanceof ApiError ? e.message : 'Ошибка поиска' });
    }
  },
  close: () => {
    seq++;
    set({ open: false, results: null, loading: false, error: '', shown: '' });
  },
}));

// Выход из аккаунта — результаты прежнего пользователя не показываем
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) useSearch.setState({ open: false, query: '', results: null, loading: false, error: '', shown: '' });
});
