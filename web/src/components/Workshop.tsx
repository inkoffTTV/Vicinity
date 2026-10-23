import { Download, Heart, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, CommunityTheme } from '../lib/api';
import { useThemeAccess } from '../lib/appearanceSync';
import { useAppearance } from '../lib/prefs';
import { useStore } from '../lib/store';
import { CustomTheme, gradientCss } from '../lib/themes';
import { Icon } from './Icon';
import { Segmented } from './SettingControls';

type Kind = 'all' | 'theme' | 'background';

/** Мастерская (docs/API.md §18): темы и фоны, которые опубликовали люди — карточки с превью, ♥ и установкой */
export function Workshop({ onPickTheme }: { onPickTheme: (t: CommunityTheme) => void }) {
  const a = useAppearance();
  const access = useThemeAccess();
  const toast = useStore((s) => s.toast);
  const me = useStore((s) => s.me);
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CommunityTheme[] | null>(null);
  const [canPublish, setCanPublish] = useState({ theme: false, background: false });
  const [publish, setPublish] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.communityThemes(sort, kind).then(
      (r) => {
        if (!alive) return;
        setItems(r.themes);
        setCanPublish({ theme: r.can_publish, background: r.can_publish_background });
      },
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, [sort, kind, tick]);

  const term = q.trim().toLowerCase();
  const shown = (items ?? []).filter((t) => !term || t.name.toLowerCase().includes(term) || t.author.display_name.toLowerCase().includes(term));
  const activeTheme = (a.preview ?? a).customTheme?.from ?? null;
  const activeBg = a.background?.from ?? null;

  const like = async (t: CommunityTheme) => {
    try {
      const r = await api.likeTheme(t.id);
      setItems((list) => list?.map((x) => (x.id === t.id ? { ...x, ...r } : x)) ?? null);
    } catch {
      toast('Не удалось', 'error');
    }
  };
  const remove = async (t: CommunityTheme) => {
    try {
      await api.deleteTheme(t.id);
      setItems((list) => list?.filter((x) => x.id !== t.id) ?? null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось удалить', 'error');
    }
  };
  const install = (t: CommunityTheme) => {
    if (t.kind === 'background') {
      if (activeBg === t.id) a.set({ background: null });
      else {
        a.set({ background: { image: t.image, from: t.id } });
        setItems((list) => list?.map((x) => (x.id === t.id ? { ...x, installs: x.installs + 1 } : x)) ?? null);
      }
      return;
    }
    onPickTheme(t);
    if (access.colorThemes && activeTheme !== t.id) setItems((list) => list?.map((x) => (x.id === t.id ? { ...x, installs: x.installs + 1 } : x)) ?? null);
  };

  return (
    <section className="workshop" aria-label="Мастерская">
      <div className="ws-toolbar">
        <Segmented<Kind>
          label=""
          value={kind}
          options={[
            ['all', 'Все'],
            ['theme', 'Темы'],
            ['background', 'Фоны'],
          ]}
          onChange={setKind}
        />
        <Segmented<'top' | 'new'>
          label=""
          value={sort}
          options={[
            ['top', 'Популярные'],
            ['new', 'Новые'],
          ]}
          onChange={setSort}
        />
        <label className="ws-search">
          <Icon icon={Search} size={15} />
          <input type="search" placeholder="Поиск по названию, автору…" aria-label="Поиск в мастерской" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={() => setPublish((v) => !v)} aria-expanded={publish}>
          <Icon icon={Upload} size={15} /> Опубликовать
        </button>
      </div>

      {publish && (
        <PublishForm
          canTheme={canPublish.theme}
          canBackground={canPublish.background}
          onDone={() => {
            setPublish(false);
            setTick((n) => n + 1);
          }}
        />
      )}

      {items === null ? (
        <div className="muted small">Загрузка…</div>
      ) : shown.length === 0 ? (
        <div className="muted small ws-empty">{term ? 'Ничего не нашлось' : 'Пока пусто — опубликуйте первую тему или фон.'}</div>
      ) : (
        <ul className="ws-grid">
          {shown.map((t) => {
            const on = t.kind === 'background' ? activeBg === t.id : activeTheme === t.id;
            const canInstall = t.kind === 'background' || access.colorThemes;
            return (
              <li key={t.id} className={`ws-card${on ? ' on' : ''}`} data-kind={t.kind}>
                <div className={`ws-preview ${t.kind}`} style={t.kind === 'background' ? { backgroundImage: `url("${t.image}")` } : { background: gradientCss(t) }} aria-hidden="true">
                  {t.kind === 'theme' && (
                    <span className="ws-mock">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
                <div className="ws-body">
                  <div className="ws-title">
                    <strong className="ellipsis">{t.name}</strong>
                    <span className="muted small ws-stat" title="Установок">
                      <Icon icon={Download} size={12} /> {t.installs}
                    </span>
                  </div>
                  <span className="muted small ellipsis">@{t.author.display_name || 'аноним'}</span>
                  <span className="muted small">{t.kind === 'background' ? 'Фон' : 'Тема'}</span>
                </div>
                <div className="ws-actions">
                  <button type="button" className={`btn small${on ? '' : ' primary'}`} aria-pressed={on} onClick={() => install(t)}>
                    {on ? 'Установлено ✓' : canInstall ? 'Установить' : 'Посмотреть'}
                  </button>
                  <button type="button" className={`like-btn${t.liked ? ' on' : ''}`} aria-pressed={t.liked} aria-label={t.liked ? 'Убрать сердечко' : 'Нравится'} onClick={() => void like(t)}>
                    <Icon icon={Heart} size={14} /> {t.likes}
                  </button>
                  {(t.mine || me?.developer) && (
                    <button type="button" className="icon-btn" aria-label={`Удалить «${t.name}»`} title="Удалить" onClick={() => void remove(t)}>
                      <Icon icon={Trash2} size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Форма публикации: текущая своя тема (Ultra) или фон — картинка с диска либо уже стоящий фон (Standard) */
function PublishForm({ canTheme, canBackground, onDone }: { canTheme: boolean; canBackground: boolean; onDone: () => void }) {
  const a = useAppearance();
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<'theme' | 'background'>(canTheme && a.customTheme && !a.customTheme.from ? 'theme' : 'background');
  const [name, setName] = useState('');
  const [image, setImage] = useState(a.background && !a.background.from ? a.background.image : '');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const theme: CustomTheme | null = a.customTheme && !a.customTheme.from ? a.customTheme : null;

  const upload = async (f: File) => {
    setBusy(true);
    try {
      setImage((await api.uploadWorkshopImage(f)).file_url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось загрузить', 'error');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    const n = name.trim();
    if (n.length < 2) return toast('Название — от 2 до 30 символов', 'error');
    setBusy(true);
    try {
      if (kind === 'theme') {
        if (!theme) return toast('Сначала соберите свою тему во вкладке «Вид»', 'error');
        await api.publishTheme({ name: n, kind: 'theme', colors: theme.colors, angle: theme.angle, base: theme.base });
      } else {
        if (!image) return toast('Выберите картинку', 'error');
        await api.publishTheme({ name: n, kind: 'background', image, colors: [], angle: 135, base: 'dark' });
      }
      toast(`«${n}» опубликовано в мастерской`);
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось опубликовать', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ws-publish"
      aria-label="Опубликовать"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Segmented<'theme' | 'background'>
        label="Что публикуем"
        value={kind}
        options={[
          ['theme', 'Тему'],
          ['background', 'Фон'],
        ]}
        onChange={setKind}
      />
      {kind === 'theme' ? (
        theme ? (
          <div className="ws-publish-row">
            <span className="ws-swatch" style={{ background: gradientCss(theme) }} aria-hidden="true" />
            <span className="muted small">Ваша текущая своя тема</span>
          </div>
        ) : (
          <span className="muted small">{canTheme ? 'Соберите свою тему во вкладке «Вид» (кнопка «+»), затем опубликуйте её здесь.' : 'Публиковать темы можно с подпиской Ultra.'}</span>
        )
      ) : (
        <div className="ws-publish-row">
          {image && <span className="ws-swatch" style={{ backgroundImage: `url("${image}")` }} aria-hidden="true" />}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <button type="button" className="btn small" disabled={busy || !canBackground} onClick={() => file.current?.click()}>
            {image ? 'Другая картинка' : 'Выбрать картинку'}
          </button>
          {!canBackground && <span className="muted small">Публиковать фоны можно с подпиской Standard.</span>}
        </div>
      )}
      <div className="ws-publish-row">
        <input type="text" maxLength={30} placeholder="Название" aria-label="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn primary small" disabled={busy || (kind === 'theme' ? !theme || !canTheme : !image || !canBackground)}>
          Опубликовать
        </button>
      </div>
    </form>
  );
}
