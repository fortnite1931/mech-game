#!/usr/bin/env node
/**
 * Сторож dev-сервера.
 *
 * На этой машине нехватка памяти: Vite (и node-тесты) иногда падают с OOM,
 * и страница перестаёт открываться. Сторож следит за процессом и поднимает
 * Vite заново, пока его не остановят (Ctrl+C).
 *
 *   node tools/dev-watch.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const URL_CHECK = 'http://localhost:5173/';
const CHECK_EVERY = 5000;

let child = null;
let restarts = 0;

function start() {
  console.log(`[watch] запуск vite (перезапуск #${restarts})`);
  child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    console.log(`[watch] vite завершился (код ${code}) — поднимаю заново через 3 с`);
    child = null;
    setTimeout(start, 3000);
  });
}

async function alive() {
  try {
    const r = await fetch(URL_CHECK, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function check() {
  if (!child) return;
  if (await alive()) return;
  console.log('[watch] dev-сервер не отвечает — перезапускаю');
  restarts++;
  try { child.kill('SIGKILL'); } catch { /* уже мёртв */ }
  child = null;
  setTimeout(start, 1500);
}

start();
setInterval(check, CHECK_EVERY);

process.on('SIGINT', () => {
  console.log('\n[watch] остановка');
  try { child?.kill('SIGKILL'); } catch { /* ignore */ }
  process.exit(0);
});
