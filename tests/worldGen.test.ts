import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, valueNoise2D, DEFAULT_WORLD_CONFIG, biomeAt, chunkPlan, findSpawn,
  PROPS_BY_BIOME, edgeHeight, worldBoundMeters,
} from '../src/three/worldGen.ts';
import type { BiomeId, WorldConfig } from '../src/three/worldGen.ts';

const ALL: BiomeId[] = ['ash', 'crack', 'ice', 'mine', 'oasis'];

test('worldBoundMeters: 0 = бесконечно, иначе км → м', () => {
  assert.equal(worldBoundMeters(DEFAULT_WORLD_CONFIG), 0);
  assert.equal(worldBoundMeters({ ...DEFAULT_WORLD_CONFIG, worldRadius: 2 }), 2000);
});

test('edgeHeight: без радиуса или типа none — высоты края нет', () => {
  assert.equal(edgeHeight(DEFAULT_WORLD_CONFIG, 5000, 0), 0);
  assert.equal(edgeHeight({ ...DEFAULT_WORLD_CONFIG, worldRadius: 1 }, 0, 0), 0);
});

test('edgeHeight: горы растут к границе и за ней', () => {
  const cfg: WorldConfig = { ...DEFAULT_WORLD_CONFIG, worldRadius: 1, edgeType: 'mountains' };
  const R = worldBoundMeters(cfg); // 1000
  assert.equal(edgeHeight(cfg, R * 0.5, 0), 0, 'внутри — ровно');
  assert.ok(edgeHeight(cfg, R, 0) > 1, 'на границе уже растёт');
  const far = edgeHeight(cfg, R + 800, 0);
  assert.ok(far > 200, 'за краем — высокие горы');
});

test('edgeHeight: вода опускает рельеф за краем', () => {
  const cfg: WorldConfig = { ...DEFAULT_WORLD_CONFIG, worldRadius: 1, edgeType: 'water' };
  const R = worldBoundMeters(cfg);
  assert.ok(edgeHeight(cfg, R + 800, 0) < -80, 'провал к морю');
});

test('edgeHeight: скалы резко поднимаются', () => {
  const cfg: WorldConfig = { ...DEFAULT_WORLD_CONFIG, worldRadius: 1, edgeType: 'cliffs' };
  const R = worldBoundMeters(cfg);
  assert.ok(edgeHeight(cfg, R + 300, 0) > 500, 'крутая стена');
});

test('mulberry32 детерминирован и в границах 0..1', () => {
  const a = mulberry32(777), b = mulberry32(777);
  for (let i = 0; i < 500; i++) {
    const v = a();
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, b());
  }
});

test('valueNoise2D плавный: соседние точки близки', () => {
  let maxJump = 0;
  for (let i = 0; i < 200; i++) {
    const t = i * 0.05;
    const v1 = valueNoise2D(42, t, t);
    const v2 = valueNoise2D(42, t + 0.05, t + 0.05);
    maxJump = Math.max(maxJump, Math.abs(v1 - v2));
  }
  assert.ok(maxJump < 0.2);
});

test('chunkPlan детерминирован; разные сиды дают разные планы', () => {
  const cfg = { ...DEFAULT_WORLD_CONFIG };
  const a = JSON.stringify(chunkPlan(cfg, 3, -2));
  const b = JSON.stringify(chunkPlan(cfg, 3, -2));
  assert.equal(a, b);
  const other = JSON.stringify(chunkPlan({ ...cfg, seed: 999 }, 3, -2));
  assert.notEqual(a, other);
});

test('propDensity=0 — пустой чанк; пропы внутри границ чанка', () => {
  const empty = chunkPlan({ ...DEFAULT_WORLD_CONFIG, propDensity: 0 }, 5, 5);
  assert.equal(empty.props.length, 0);
  const cs = DEFAULT_WORLD_CONFIG.chunkSize;
  const plan = chunkPlan(DEFAULT_WORLD_CONFIG, -4, 7);
  const x0 = -4 * cs, z0 = 7 * cs;
  for (const p of plan.props) {
    assert.ok(p.x >= x0 && p.x < x0 + cs, 'x в чанке');
    assert.ok(p.z >= z0 && p.z < z0 + cs, 'z в чанке');
    assert.ok(p.s > 0.5 && p.s < 1.6, 'масштаб разумный');
    assert.equal(typeof p.rot, 'number');
  }
});

test('кинд пропа существует в таблице биома', () => {
  for (const biome of ALL) {
    const kinds = PROPS_BY_BIOME[biome];
    assert.ok(kinds.length > 0);
    for (const k of kinds) assert.equal(typeof k, 'string');
  }
  for (const p of chunkPlan(DEFAULT_WORLD_CONFIG, 0, 0).props) {
    assert.ok(PROPS_BY_BIOME[chunkPlan(DEFAULT_WORLD_CONFIG, 0, 0).biome].includes(p.kind));
  }
});

test('biomeAt определён для всех точек; оазис редкий', () => {
  let oasis = 0, total = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (i * 137) % 3000 - 1500;
    const z = (i * 541) % 3000 - 1500;
    const b = biomeAt(DEFAULT_WORLD_CONFIG, x, z);
    assert.ok(ALL.includes(b));
    total++;
    if (b === 'oasis') oasis++;
  }
  assert.ok(oasis / total < 0.15, 'оазисы редкие');
  assert.ok(oasis > 0, 'но существуют');
});

test('findSpawn на ash, в разумной дистанции от старта', () => {
  const s = findSpawn(DEFAULT_WORLD_CONFIG);
  assert.equal(biomeAt(DEFAULT_WORLD_CONFIG, s.x, s.z), 'ash');
  const d = Math.hypot(s.x, s.z);
  assert.ok(d < DEFAULT_WORLD_CONFIG.chunkSize * 30, 'спавн не слишком далеко');
});
