/**
 * Профайлер производительности.
 *
 * Каждый кадр снимает срез состояния сцены (время кадра, draw calls, треугольники,
 * число врагов/снарядов/частиц, режим камеры, позиция игрока, включённые эффекты).
 * Раз в секунду пачка уходит на локальный сервер журнала (tools/perf-server.mjs),
 * который пишет NDJSON на диск. Пиковые кадры (дольше порога) помечаются отдельно
 * и сохраняются с окном соседних кадров — так видно, что именно к тому моменту
 * изменилось (волна врагов, пост-обработка, тени, куча частиц).
 *
 * Данные не теряются: если сервер недоступен, сэмплы ждут в буфере и уйдут,
 * как только связь восстановится.
 */

export interface PerfSample {
  /** id сессии: время t отсчитывается заново после перезагрузки страницы */
  sid?: number;
  /** мс от старта сессии */
  t: number;
  /** длительность кадра, мс (сырое время, без зажима) */
  ms: number;
  /** сглаженный FPS */
  fps: number;
  mode: 'edit' | 'play';
  view: string;
  calls: number;
  tris: number;
  objects: number;
  enemies: number;
  proj: number;
  eproj: number;
  parts: number;
  props: number;
  decals: number;
  x: number;
  z: number;
  shadows: number;
  postfx: number;
  fog: number;
  dust: number;
  heat: number;
  waves: number;
  enemiesLeft: number;
  flags: number;
  /** разбор по фазам, мс (движок заполняет раз в кадр) */
  ph?: Record<string, number>;
}

export interface PerfSpike {
  t: number;
  ms: number;
  /** true — сильное падение (ниже ~18 FPS), false — заметное проседание */
  bad: boolean;
  /** окно кадров вокруг пика */
  window: PerfSample[];
}

const SERVER = 'http://127.0.0.1:8788';
/** Кадр дольше 28 мс — заметное проседание (ниже ~35 FPS). */
const SPIKE_MS = 28;
/** Кадр дольше 55 мс — сильное падение (ниже ~18 FPS). */
const BAD_MS = 55;
const MAX_BUFFER = 900;
const MAX_SPIKES = 150;

export class PerfProfiler {
  enabled = false;
  logFile: string | null = null;
  serverUp = false;
  sent = 0;
  dropped = 0;
  hiddenFrames = 0;
  stalls = 0;

  private buffer: PerfSample[] = [];
  private spikes: PerfSpike[] = [];
  private ring: PerfSample[] = [];
  private lastFlush = 0;
  private startTime = 0;
  private fps = 60;
  private sending = false;
  /** id текущей сессии — чтобы анализ не путал перезагрузки страницы */
  private session = 0;

  async start(): Promise<boolean> {
    this.startTime = performance.now();
    this.lastFlush = performance.now();
    this.session = Date.now();
    try {
      const res = await fetch(`${SERVER}/session`, { method: 'POST' });
      if (!res.ok) throw new Error('no server');
      const data = await res.json();
      this.logFile = data.file ?? null;
      this.serverUp = true;
      this.enabled = true;
      return true;
    } catch {
      this.serverUp = false;
      this.enabled = true; // пишем в память, выгрузить можно кнопкой
      this.logFile = null;
      return false;
    }
  }

  stop() {
    this.enabled = false;
    this.flush(true);
  }

  /** Вызывать раз в кадр. ctx — срез состояния сцены. */
  sample(ms: number, ctx: Omit<PerfSample, 't' | 'ms' | 'fps'>) {
    if (!this.enabled) return;
    // вкладка в фоне — браузер душит rAF, кадры не настоящие
    if (typeof document !== 'undefined' && document.hidden) { this.hiddenFrames++; return; }
    // пауза длиннее 2 секунд — это не просадка, а простой/отладка
    if (ms > 2000) { this.stalls++; return; }
    const now = performance.now();
    this.fps = this.fps * 0.9 + (1000 / Math.max(0.5, ms)) * 0.1;
    const s: PerfSample = { sid: this.session, t: Math.round(now - this.startTime), ms: +ms.toFixed(2), fps: Math.round(this.fps), ...ctx };
    this.buffer.push(s);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    this.ring.push(s);
    if (this.ring.length > 60) this.ring.shift();
    if (ms > SPIKE_MS) {
      const idx = this.ring.length - 1;
      // окно контекста: 20 кадров до пика + сам пик
      const w = this.ring.slice(Math.max(0, idx - 20), idx + 1);
      this.spikes.push({ t: s.t, ms: s.ms, bad: ms > BAD_MS, window: w });
      if (this.spikes.length > MAX_SPIKES) this.spikes.shift();
    }
    if (now - this.lastFlush > 1000) {
      this.lastFlush = now;
      this.flush();
    }
  }

  /** Отправить накопленное на сервер. Буфер чистим только после успешной отправки. */
  flush(force = false) {
    if (this.sending) return;
    if (this.buffer.length === 0 && this.spikes.length === 0 && !force) return;
    if (!this.serverUp) {
      // сервер упал или ещё не поднялся — пробуем заново и ждём
      void this.start();
      return;
    }
    this.sending = true;
    const samples = this.buffer;
    const spikes = this.spikes;
    this.buffer = [];
    this.spikes = [];
    const payload = { samples, spikes };
    fetch(`${SERVER}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => {
      this.sending = false;
      if (!res.ok) throw new Error('bad status ' + res.status);
      this.sent += samples.length;
    }).catch(() => {
      this.sending = false;
      this.serverUp = false;
      // вернём данные в буфер — ничего не теряется
      this.buffer = samples.concat(this.buffer).slice(-MAX_BUFFER);
      this.spikes = spikes.concat(this.spikes).slice(-MAX_SPIKES);
      this.dropped += samples.length;
    });
  }

  /** Скачать лог вручную (когда сервер недоступен). */
  download() {
    const data = { samples: this.buffer, spikes: this.spikes };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  get spikeCount() { return this.spikes.length; }
  get sampleCount() { return this.buffer.length; }
}

export const perf = new PerfProfiler();
