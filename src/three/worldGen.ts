export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(a: number, b: number, c: number, d = 0): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1) ^ Math.imul(d, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function nodeValue(seed: number, ix: number, iz: number): number {
  return mulberry32(hash3(seed, ix, iz, 0x2545f491))();
}

export function valueNoise2D(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const v00 = nodeValue(seed, ix, iz);
  const v10 = nodeValue(seed, ix + 1, iz);
  const v01 = nodeValue(seed, ix, iz + 1);
  const v11 = nodeValue(seed, ix + 1, iz + 1);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sz;
}

export interface WorldConfig {
  seed: number;
  chunkSize: number;
  propDensity: number;
  oasisChance: number;
  /** Радиус карты в километрах. 0 = бесконечный мир (без краёв). */
  worldRadius: number;
  /** Чем закрываем край карты: горы, скалы, вода (провал), лес или ничем. */
  edgeType: EdgeType;
  /** Зоны (цели зачистки) на карте. */
  zones?: ZoneDef[];
  enabled?: boolean;
  randomSpawn?: boolean;
}

export type EdgeType = 'none' | 'mountains' | 'cliffs' | 'water' | 'forest';

/** Зона карты: точка интереса с радиусом. Враги внутри — цель зачистки. */
export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 1337,
  chunkSize: 24,
  propDensity: 1,
  oasisChance: 0.02,
  worldRadius: 0,
  edgeType: 'none',
  enabled: true,
};

/** Радиус карты в метрах (0 — бесконечный мир). */
export function worldBoundMeters(cfg: WorldConfig): number {
  return cfg.worldRadius > 0 ? cfg.worldRadius * 1000 : 0;
}

const smooth01 = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Добавка высоты у края карты по типу края (горы/скалы/вода/лес).
 * Возвращает 0, если радиус не задан или тип 'none'.
 * Подъём начинается заранее (за буфер до границы), чтобы край был виден издалека.
 */
export function edgeHeight(cfg: WorldConfig, x: number, z: number): number {
  const R = worldBoundMeters(cfg);
  if (R <= 0 || cfg.edgeType === 'none') return 0;
  const d = Math.sqrt(x * x + z * z);
  switch (cfg.edgeType) {
    case 'mountains': {
      const over = d - R + 250; // начинаем за 250 м до границы
      const t = clamp01(over / 500);
      return smooth01(t) * 260;
    }
    case 'cliffs': {
      const over = d - R + 60;
      const t = clamp01(over / 160);
      return smooth01(t) * 600;
    }
    case 'water': {
      const over = d - R + 250;
      const t = clamp01(over / 500);
      return -smooth01(t) * 140;
    }
    case 'forest': {
      const over = d - R + 350;
      const t = clamp01(over / 700);
      return smooth01(t) * 90;
    }
    default:
      return 0;
  }
}

export type BiomeId = 'ash' | 'crack' | 'ice' | 'mine' | 'oasis';

export function biomeAt(cfg: WorldConfig, wx: number, wz: number): BiomeId {
  const cx = Math.floor(wx / cfg.chunkSize);
  const cz = Math.floor(wz / cfg.chunkSize);
  const oasisNoise = valueNoise2D(hash3(cfg.seed, cx, cz, 0x68bc21eb), wx, wz);
  if (oasisNoise < cfg.oasisChance) return 'oasis';
  const n = valueNoise2D(hash3(cfg.seed, cx, cz, 0x1b873593), wx, wz);
  if (n > 0.78) return 'crack';
  if (n > 0.62) return 'ice';
  if (n > 0.55) return 'mine';
  return 'ash';
}

export const PROPS_BY_BIOME: Record<BiomeId, string[]> = {
  ash: ['barrel', 'car_wreck', 'scrap', 'slab', 'cone'],
  crack: ['scrap', 'slab', 'husk', 'bricks'],
  ice: ['scrap', 'slab', 'cone'],
  mine: ['barrel', 'bricks', 'rails', 'husk'],
  oasis: ['dead_tree', 'grass', 'rock'],
};

export function chunkPlan(
  cfg: WorldConfig,
  cx: number,
  cz: number
): { biome: BiomeId; props: { kind: string; x: number; z: number; rot: number; s: number }[] } {
  const cs = cfg.chunkSize;
  const biome = biomeAt(cfg, (cx + 0.5) * cs, (cz + 0.5) * cs);
  const countSeed = hash3(cfg.seed, cx, cz, 0x9e3779b9);
  let total = Math.floor((3 + valueNoise2D(countSeed, cx * 7, cz * 7) * 6) * cfg.propDensity);
  if (biome === 'oasis' && total < 1 && (cx + cz) % 2 === 0) total = 1;
  const rng = mulberry32(hash3(cfg.seed, cx, cz, 0x7feb352d));
  const table = PROPS_BY_BIOME[biome];
  const props: { kind: string; x: number; z: number; rot: number; s: number }[] = [];
  for (let i = 0; i < total; i++) {
    props.push({
      kind: table[Math.floor(rng() * table.length) % table.length],
      x: (cx + rng()) * cs,
      z: (cz + rng()) * cs,
      rot: rng() * Math.PI * 2,
      s: 0.7 + rng() * 0.8,
    });
  }
  return { biome, props };
}

export function findSpawn(cfg: WorldConfig): { x: number; z: number } {
  const cs = cfg.chunkSize;
  const px = (c: number) => (c + 0.5) * cs;
  for (let r = 0; r <= 128; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = px(dx);
        const z = px(dz);
        if (biomeAt(cfg, x, z) === 'ash') return { x, z };
      }
    }
  }
  return { x: px(0), z: px(0) };
}
