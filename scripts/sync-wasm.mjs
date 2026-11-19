import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const targetDir = join(rootDir, 'demo-app', 'public', 'wasm');

const candidates = [
  join(rootDir, 'node_modules', '@litert-lm', 'core', 'wasm'),
  join(rootDir, 'packages', 'core', 'node_modules', '@litert-lm', 'core', 'wasm'),
  join(rootDir, 'demo-app', 'node_modules', '@litert-lm', 'core', 'wasm'),
];

const sourceDir = candidates.find((dir) => existsSync(dir));
if (!sourceDir) {
  console.error('Could not find @litert-lm/core/wasm directory. Run npm install first.');
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
const files = readdirSync(sourceDir);
for (const file of files) {
  cpSync(join(sourceDir, file), join(targetDir, file), { force: true });
}

console.log(`Synced ${files.length} LiteRT-LM WASM assets to demo-app/public/wasm/`);
