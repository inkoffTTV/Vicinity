// Фоновый поток для капчи: перебор не подвешивает интерфейс
import { solve } from './altchaSolve';

self.onmessage = (e: MessageEvent<{ salt: string; challenge: string; max: number }>) => {
  const { salt, challenge, max } = e.data;
  (self as unknown as Worker).postMessage({ number: solve(salt, challenge, max) });
};
