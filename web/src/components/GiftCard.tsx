import { Gift } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, GiftInfo } from '../lib/api';
import { loadPlan } from '../lib/plan';
import { useGift } from '../lib/router';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { Modal } from './Modal';

const TIER_TAG = ['', 'BASIC', 'STANDARD', 'ULTRA'];

/** Подарочный код по ссылке /gift/<код> (docs/API.md §17): что внутри и кнопка «Активировать» */
export function GiftCard({ code }: { code: string }) {
  const dismiss = useGift((s) => s.dismiss);
  const toast = useStore((s) => s.toast);
  const refreshMe = useStore((s) => s.refreshMe);
  const [info, setInfo] = useState<GiftInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    api.giftInfo(code).then(setInfo, (e) => setError(e instanceof ApiError && e.status === 404 ? 'Такого подарка нет: код неверный' : 'Не удалось проверить код'));
  }, [code]);

  const redeem = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.giftRedeem(code);
      await Promise.all([refreshMe(), loadPlan()]);
      setDone(`Подписка ${r.name} активна${r.until ? ` до ${new Date(r.until.replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU')}` : ''}`);
      toast(`Подарок активирован: ${r.name}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={dismiss} bare>
      <div className="invite-card gift-card" role="group" aria-label="Подарочный код">
        <span className="invite-card-icon gift-icon">
          <Icon icon={Gift} size={28} />
        </span>
        <div className="muted small">Подарочный код подписки</div>
        {info ? (
          <>
            <h2>
              {info.name} <span className={`tier-tag t${info.tier}`}>{TIER_TAG[info.tier]}</span>
            </h2>
            <div className="muted">на {info.days} дн.</div>
          </>
        ) : (
          <h2>{error || 'Проверяем…'}</h2>
        )}
        {done && <div className="form-ok">{done}</div>}
        {error && info && <div className="form-error">{error}</div>}
        <div className="invite-card-actions">
          <button className="btn" onClick={dismiss}>
            Закрыть
          </button>
          {info && !done && (
            <button className="btn primary" autoFocus disabled={busy || info.redeemed} onClick={() => void redeem()}>
              {info.redeemed ? 'Уже активирован' : 'Активировать'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
