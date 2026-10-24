#!/usr/bin/env node
/**
 * Разбор журнала производительности.
 *
 *   node tools/perf-report.mjs [файл]     (по умолчанию — последний в logs/)
 *
 * Печатает: общую сводку, худшие кадры с контекстом (что изменилось в момент
 * просадки) и корреляции медленных кадров со счётчиками сцены.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.resolve(__dirname, '..', 'logs');

function pickFiles() {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) return [arg];
  if (!fs.existsSync(LOGS_DIR)) { console.error('Нет папки logs/'); process.exit(1); }
  let files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.ndjson')).sort();
  if (!files.length) { console.error('В logs/ нет логов'); process.exit(1); }
  if (arg === '--last') files = files.slice(-1);
  return files.map((f) => path.join(LOGS_DIR, f));
}

const files = pickFiles();
const samples = [];
const spikes = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (Array.isArray(o.samples)) samples.push(...o.samples);
      if (Array.isArray(o.spikes)) spikes.push(...o.spikes);
    } catch { /* битая строка — пропускаем */ }
  }
}
samples.sort((a, b) => (a.sid ?? 0) - (b.sid ?? 0) || a.t - b.t);

// ─────────── сводка по сессиям (после перезагрузки время t начинается заново) ───────────
const bySession = new Map();
for (const s of samples) {
  const k = s.sid ?? 0;
  if (!bySession.has(k)) bySession.set(k, []);
  bySession.get(k).push(s);
}
const sessions = [...bySession.entries()]
  .map(([k, arr]) => {
    const play = arr.filter((s) => s.mode === 'play');
    let sum = 0, worst = 0, slow = 0;
    for (const s of play) {
      sum += s.ms;
      if (s.ms > worst) worst = s.ms;
      if (s.ms > 33) slow++;
    }
    return {
      k,
      total: arr.length,
      play: play.length,
      avgFps: play.length ? 1000 / (sum / play.length) : 0,
      worst,
      slow,
    };
  })
  .filter((s) => s.play > 20)
  .sort((a, b) => b.play - a.play);

if (sessions.length) {
  console.log('── СЕССИИ С ИГРОЙ (топ-10 по объёму) ────────────────────────────────');
  console.log('session           кадров  игровых   avg FPS   худший кадр  <30fps');
  for (const s of sessions.slice(0, 10)) {
    console.log(
      `${String(s.k).slice(-9).padStart(12)} ${String(s.total).padStart(9)} ${String(s.play).padStart(8)} ${s.avgFps.toFixed(1).padStart(10)} ${(s.worst.toFixed(0) + 'мс').padStart(13)} ${String(s.slow).padStart(8)}`
    );
  }
  console.log('');
}

// отбрасываем артефакты: вкладка в фоне (rAF душится) и паузы длиннее 2 с
const artifacts = samples.filter((s) => s.ms > 2000);
const real = samples.filter((s) => s.ms <= 2000);
// разрывы > 3 секунды между кадрами — тоже фон/пауза
const gaps = [];
for (let i = 1; i < real.length; i++) {
  const d = real[i].t - real[i - 1].t;
  if (d > 3000) gaps.push({ at: real[i].t, gap: d });
}

if (!samples.length) {
  console.log(`Файлов: ${files.length}. Сэмплов нет (${lines.length} строк).`);
  process.exit(0);
}

const ms = real.map((s) => s.ms);
const sorted = [...ms].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

console.log('═'.repeat(78));
console.log('ЖУРНАЛ ПРОИЗВОДИТЕЛЬНОСТИ');
console.log('═'.repeat(78));
console.log(`Файлы       : ${files.length} (${files.map((f) => path.basename(f)).join(', ')})`);
console.log(`Сэмплов     : ${real.length} реальных (отброшено ${artifacts.length} фоновых/пауз, разрывов ${gaps.length})`);
console.log(`Пиков       : ${spikes.length}`);
console.log(`Охват       : ${(real[0]?.t / 1000).toFixed(1)} c … ${(real[real.length - 1]?.t / 1000).toFixed(1)} c`);
console.log(`Кадр (мс)   : avg ${avg(ms).toFixed(1)} | min ${sorted[0].toFixed(1)} | p50 ${pct(0.5).toFixed(1)} | p95 ${pct(0.95).toFixed(1)} | p99 ${pct(0.99).toFixed(1)} | max ${sorted[sorted.length - 1].toFixed(1)}`);
console.log(`FPS         : avg ${(1000 / avg(ms)).toFixed(1)} | худший ${(1000 / sorted[sorted.length - 1]).toFixed(1)}`);

const slow30 = ms.filter((v) => v > 33).length;
const slow20 = ms.filter((v) => v > 50).length;
const frozen = ms.filter((v) => v > 100).length;
console.log(`Просадки    : <30fps ${(slow30 / ms.length * 100).toFixed(1)}% | <20fps ${(slow20 / ms.length * 100).toFixed(1)}% | >100мс ${frozen} (${(frozen / ms.length * 100).toFixed(2)}%)`);
console.log('');

// ---- по режимам ----
const byMode = new Map();
for (const s of real) {
  const k = `${s.mode}/${s.view}`;
  if (!byMode.has(k)) byMode.set(k, []);
  byMode.get(k).push(s);
}
console.log('── ПО РЕЖИМАМ ──────────────────────────────────────────────────────────');
console.log('режим              кадров   avg fps   p95 fps   <30fps%');
for (const [k, arr] of byMode) {
  const a = arr.map((s) => s.ms);
  const as = [...a].sort((x, y) => x - y);
  const p95 = as[Math.min(as.length - 1, Math.floor(as.length * 0.95))];
  const s30 = a.filter((v) => v > 33).length;
  console.log(`${k.padEnd(18)} ${String(arr.length).padStart(6)}   ${(1000 / avg(a)).toFixed(1).padStart(7)}   ${(1000 / p95).toFixed(1).padStart(8)}   ${(s30 / a.length * 100).toFixed(1).padStart(6)}%`);
}
console.log('');

// ---- разбор по фазам ----
const withPh = real.filter((s) => s.ph && Object.keys(s.ph).length);
if (withPh.length) {
  console.log('── РАЗБОР ПО ФАЗАМ (мс, среднее по игровым кадрам) ──────────────────');
  const keys = [...new Set(withPh.flatMap((s) => Object.keys(s.ph)))];
  for (const k of keys) {
    const a = withPh.map((s) => s.ph[k] ?? 0);
    const as = [...a].sort((x, y) => x - y);
    const p95 = as[Math.min(as.length - 1, Math.floor(as.length * 0.95))];
    const max = as[as.length - 1];
    console.log(`${k.padEnd(10)} avg ${avg(a).toFixed(2).padStart(7)}   p95 ${p95.toFixed(2).padStart(7)}   max ${max.toFixed(2).padStart(8)}`);
  }
  console.log('');
}

// ---- корреляции ----
const keys = ['calls', 'tris', 'objects', 'enemies', 'proj', 'eproj', 'parts', 'props', 'decals'];
console.log('── ЧТО КОРРЕЛИРУЕТ С ПРОСАДКОЙ (среднее по медленным / быстрым кадрам) ──');
const slow = real.filter((s) => s.ms > 33);
const fast = real.filter((s) => s.ms <= 33);
console.log('счётчик        медленные   быстрые    разница');
if (slow.length && fast.length) {
  for (const k of keys) {
    const a = avg(slow.map((s) => s[k] ?? 0));
    const b = avg(fast.map((s) => s[k] ?? 0));
    const d = a - b;
    const mark = Math.abs(d) > Math.max(1, b * 0.25) ? '  <<<' : '';
    console.log(`${k.padEnd(14)} ${a.toFixed(1).padStart(9)} ${b.toFixed(1).padStart(9)} ${(d >= 0 ? '+' : '') + d.toFixed(1).padStart(9)}${mark}`);
  }
  for (const k of ['shadows', 'postfx', 'fog', 'dust']) {
    const a = avg(slow.map((s) => s[k] ?? 0));
    const b = avg(fast.map((s) => s[k] ?? 0));
    console.log(`${k.padEnd(14)} ${a.toFixed(2).padStart(9)} ${b.toFixed(2).padStart(9)} ${(a - b >= 0 ? '+' : '') + (a - b).toFixed(2).padStart(9)}`);
  }
}
console.log('');

// ---- худшие кадры ----
console.log('── ХУДШИЕ КАДРЫ ───────────────────────────────────────────────────────');
const worst = [...real].sort((a, b) => b.ms - a.ms).slice(0, 12);
console.log('   t(с)    мс   fps  режим        враги снаряды частицы объекты calls  трис');
for (const s of worst) {
  console.log(
    `${(s.t / 1000).toFixed(2).padStart(7)} ${s.ms.toFixed(1).padStart(6)} ${String(s.fps).padStart(5)}  ${`${s.mode}/${s.view}`.padEnd(12)} ${String(s.enemies).padStart(5)} ${String(s.proj).padStart(7)} ${String(s.parts).padStart(7)} ${String(s.objects).padStart(8)} ${String(s.calls).padStart(5)} ${String(s.tris).padStart(6)}`
  );
}
console.log('');

// ---- контекст пиков ----
console.log('── КОНТЕКСТ СИЛЬНЫХ ПИКОВ (что менялось в момент падения) ─────────────');
const bad = spikes.filter((s) => s.bad).slice(0, 8);
if (!bad.length) console.log('Сильных пиков (>50мс) нет.');
for (const sp of bad) {
  const w = sp.window;
  if (!w.length) continue;
  const prev = w[Math.max(0, w.length - 2)];
  console.log(`\n▸ t=${(sp.t / 1000).toFixed(2)}s  ${sp.ms.toFixed(1)}мс`);
  const keysCmp = ['enemies', 'proj', 'eproj', 'parts', 'props', 'objects', 'calls', 'tris'];
  for (const k of keysCmp) {
    const before = prev[k] ?? 0;
    const at = w[w.length - 1][k] ?? 0;
    if (before !== at) console.log(`   ${k}: ${before} → ${at}`);
  }
  const sh = w[w.length - 1];
  console.log(`   режим ${sh.mode}/${sh.view} · тени ${sh.shadows} · пост ${sh.postfx} · туман ${sh.fog} · пыль ${sh.dust} · HP-тепло ${sh.heat} · волна ${sh.waves}`);
}
console.log('');
console.log('═'.repeat(78));
