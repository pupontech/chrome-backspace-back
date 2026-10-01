// Explicit runtime allowlist; no dependencies or development files ship.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.platform === 'win32' ? 'python' : 'python3', [resolve(root, 'scripts/package.py')], { cwd: root, stdio: 'inherit' });
