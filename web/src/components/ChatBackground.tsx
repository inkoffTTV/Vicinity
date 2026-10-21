import { CSSProperties, useState } from 'react';
import { api, ApiError, ChatBg } from '../lib/api';
import { BG_PRESETS, bgCss, parseBg, proposalText, usePersonalBg } from '../lib/chatBg';
import { useStore } from '../lib/store';
import { Modal } from './Modal';

type S = ReturnType<typeof useStore.getState>;

/** Фон канала сервера как строка (строка стабильна для селектора; разбор — в компоненте) */
const selectChannelBgRaw = (channelId: number) => (s: S) => {
  for (const chs of Object.values(s.channelsByServer)) {
    const c = chs.find((x) => x.id === channelId);
    if (c) return c.background ?? null;
  }
  return null;
};

function styleFor(bg: ChatBg): CSSProperties {
  return { '--chat-bg': bgCss(bg), '--chat-bg-dim': `${bg.dim ?? 40}%` } as CSSProperties;
}

/** Слой под сообщениями: личный фон важнее фона канала */
export function ChatBgLayer({ channelId }: { channelId: number }) {
  const personal = usePersonalBg((s) => s.bgs[channelId]);
  const raw = useStore(selectChannelBgRaw(channelId));
  const bg = personal ?? (raw ? parseBg(raw) : null);
  if (!bg) return null;
  return <div className={`chat-bg${bg.blur ? ' blur' : ''}`} aria-hidden="true" style={styleFor(bg)} />;
}

/** Карточка «Фон чата: …» в сообщении — собеседник может поставить предложенный фон себе */
export function BgProposal({ bg, channelId }: { bg: ChatBg; channelId: number }) {
  const setPersonal = usePersonalBg((s) => s.set);
  const toast = useStore((s) => s.toast);
  return (
    <div className="bg-proposal">
      <div className={`bg-preview${bg.blur ? ' blur' : ''}`} style={styleFor(bg)} aria-hidden="true" />
      <div className="grow">
        <span>Предлагает фон чата</span>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setPersonal(channelId, bg);
            toast('Фон установлен');
          }}
        >
          Поставить себе
        </button>
      </div>
    </div>
  );
}

interface DialogProps {
  channelId: number;
  /** personal — у себя в браузере (личка, беседа); channel — у всех в канале сервера (владелец) */
  mode: 'personal' | 'channel';
  /** Личка и беседа: можно отправить фон собеседнику сообщением */
  canPropose: boolean;
  onClose: () => void;
}

export function ChatBgDialog({ channelId, mode, canPropose, onClose }: DialogProps) {
  const personal = usePersonalBg((s) => s.bgs[channelId]);
  const setPersonal = usePersonalBg((s) => s.set);
  const raw = useStore(selectChannelBgRaw(channelId));
  const toast = useStore((s) => s.toast);
  const sendMessage = useStore((s) => s.sendMessage);
  const [draft, setDraft] = useState<ChatBg | null>(() => (mode === 'personal' ? personal ?? null : raw ? parseBg(raw) : null));
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<ChatBg>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const choose = (p: Pick<ChatBg, 'preset'> | Pick<ChatBg, 'image'>) => setDraft((d) => ({ dim: d?.dim ?? 40, blur: d?.blur, ...p }));
  const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Не получилось, попробуйте ещё раз');

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const r = mode === 'channel' ? await api.uploadChannelBackground(channelId, file) : await api.uploadChatBackground(file);
      choose({ image: r.file_url });
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async (propose: boolean) => {
    setBusy(true);
    try {
      if (mode === 'channel') await api.setChannelBackground(channelId, draft);
      else {
        setPersonal(channelId, draft);
        if (propose && draft) sendMessage(channelId, proposalText(draft), null);
      }
      toast(draft ? 'Фон установлен' : 'Фон убран');
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Фон чата" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          {mode === 'channel' ? 'Фон канала видят все участники сервера.' : 'Фон виден только вам; собеседнику его можно предложить.'}
        </p>
        <div className={`bg-preview${draft?.blur ? ' blur' : ''}`} style={draft ? styleFor(draft) : undefined} aria-hidden="true">
          <span className="sample">Привет! Как дела?</span>
        </div>
        <div className="bg-dialog-grid" role="group" aria-label="Фон">
          <button type="button" className="bg-swatch none" aria-pressed={!draft} onClick={() => setDraft(null)}>
            Без фона
          </button>
          {BG_PRESETS.map((p) => (
            <button key={p.id} type="button" className="bg-swatch" aria-pressed={draft?.preset === p.id} style={{ background: p.css }} onClick={() => choose({ preset: p.id })}>
              {p.name}
            </button>
          ))}
          <label className="bg-swatch" aria-pressed={!!draft?.image} style={draft?.image ? { backgroundImage: `url("${draft.image}")` } : undefined}>
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            {draft?.image ? 'Своя картинка' : 'Загрузить…'}
          </label>
        </div>
        {draft && (
          <>
            <label className="range-row">
              Затемнение
              <input type="range" min={0} max={80} value={draft.dim ?? 40} onChange={(e) => patch({ dim: Number(e.target.value) })} />
              <span className="muted small">{draft.dim ?? 40}%</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={!!draft.blur} onChange={(e) => patch({ blur: e.target.checked })} />
              Размыть
            </label>
          </>
        )}
        <div className="bg-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          {canPropose && mode === 'personal' && draft && (
            <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
              Сохранить и предложить собеседнику
            </button>
          )}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save(false)}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
