#!/usr/bin/env node
/**
 * Сервер журнала производительности.
 *
 * Редактор шлёт сэмплы кадра (JSON) на http://127.0.0.1:8788/log — сервер пишет их
 * в NDJSON-файл в папке logs/. Файл можно открыть и разобрать после игры.
 *
 *   POST /session   — начать новую сессию (новый файл), вернуть путь
 *   POST /log       — дописать строки (NDJSON или JSON-массив)
 *   GET  /log       — вернуть текущий лог целиком
 *   GET  /status    — статус сессии
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const PORT = 8788;
const HOST = '127.0.0.1';

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

let currentFile = null;
let lineCount = 0;
let sessionStarted = 0;

function newSession() {
  // если текущий файл пустой (перезагрузка страницы) — переиспользуем его,
  // иначе в logs/ копится мусор из сотен пустых сессий
  if (currentFile && lineCount === 0 && fs.existsSync(currentFile)) {
    console.log(`[perf] reuse session -> ${currentFile}`);
    return currentFile;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  currentFile = path.join(LOGS_DIR, `perf-${stamp}.ndjson`);
  fs.writeFileSync(currentFile, '', 'utf8');
  lineCount = 0;
  sessionStarted = Date.now();
  console.log(`[perf] new session -> ${currentFile}`);
  return currentFile;
}

function append(text) {
  if (!currentFile) newSession();
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return { ok: true, lines: 0 };
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  fs.appendFileSync(currentFile, lines.join('\n') + '\n', 'utf8');
  lineCount += lines.length;
  return { ok: true, lines: lines.length, total: lineCount };
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  if (origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden origin' }));
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET') {
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file: currentFile, lines: lineCount, uptimeMs: Date.now() - sessionStarted }));
      return;
    }
    if (req.url === '/log') {
      const body = currentFile && fs.existsSync(currentFile) ? fs.readFileSync(currentFile, 'utf8') : '';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
      return;
    }
    res.writeHead(404); res.end('not found'); return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c.toString(); });
    req.on('end', () => {
      if (req.url === '/session') {
        const file = newSession();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file }));
        return;
      }
      if (req.url === '/log') {
        try {
          const result = append(body);
          console.log(`[perf] +${result.lines} строк (всего ${result.total})`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          console.error(`[perf] ошибка записи: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
      res.writeHead(404); res.end('not found');
    });
    return;
  }

  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`[perf] logger listening on http://${HOST}:${PORT}`);
  console.log(`[perf] logs dir: ${LOGS_DIR}`);
  newSession();
});
