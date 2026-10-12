// Капча ALTCHA: получить задачу у сервера, решить её в фоне и вернуть решение для /auth/register/start.
import { AltchaChallenge, api } from './api';
import { solve } from './altchaSolve';

function solveInWorker(ch: AltchaChallenge): Promise<number> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./altcha.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // Без Web Worker — в основном потоке (интерфейс замрёт на доли секунды)
      resolve(solve(ch.salt, ch.challenge, ch.maxnumber));
      return;
    }
    worker.onmessage = (e: MessageEvent<{ number: number }>) => {
      worker.terminate();
      resolve(e.data.number);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(solve(ch.salt, ch.challenge, ch.maxnumber));
    };
    worker.postMessage({ salt: ch.salt, challenge: ch.challenge, max: ch.maxnumber });
  });
}

/** Решение капчи: base64(JSON) для поля altcha. Бросает Error, если решить не удалось. */
export async function solveAltcha(): Promise<string> {
  const ch = await api.challenge();
  const started = performance.now();
  const number = await solveInWorker(ch);
  if (number < 0) throw new Error('Не удалось пройти проверку — обновите страницу');
  return btoa(
    JSON.stringify({
      algorithm: ch.algorithm,
      challenge: ch.challenge,
      number,
      salt: ch.salt,
      signature: ch.signature,
      took: Math.round(performance.now() - started),
    }),
  );
}
