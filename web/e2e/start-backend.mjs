// Поднимает собранный VicinityServer с чистой базой во временной папке — для e2e-тестов.
// Бинарник: VICINITY_SERVER_BIN или ../build/backend/VicinityServer. Порт: VICINITY_E2E_PORT (18080).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const bin = resolve(process.env.VICINITY_SERVER_BIN ?? join(root, 'build/backend/VicinityServer'));
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);

if (!existsSync(bin)) {
  console.error(`VicinityServer not found at ${bin}. Build the backend or set VICINITY_SERVER_BIN.`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'vicinity-e2e-'));
const config = JSON.parse(readFileSync(join(root, 'backend/config.json'), 'utf8'));
config.listeners[0].port = port;
config.app.log_level = 'WARN';
delete config.app.log_path;
writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));

const child = spawn(bin, [], { cwd: dir, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
