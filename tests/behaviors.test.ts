import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementDefaults, readMovement, stepMovement, moveDistance, type MovementState,
} from '../src/three/runtime/movement.ts';
import {
  weaponsDefaults, readWeapons, makeCooldowns, tickWeapons, tryFireSlot, type HeatState,
} from '../src/three/runtime/weapons.ts';
import { WEAPONS } from '../src/three/playTypes.ts';
import { resolveRuntime } from '../src/three/runtime/index.ts';
import { defaultTypes } from '../src/game/project.ts';

const IDLE = { forward: 0, turn: 0, boost: false, jet: false };
const ENV = { groundY: 0, speedMul: 1, turnMul: 1, overheated: false, locked: false };

function fresh(): MovementState {
  return { speed: 0, vy: 0, y: 0, yaw: 0, airborne: false, jetFuel: 100, heat: 0, landing: 0, jumping: false };
}

test('настройки движения читаются и чинятся', () => {
  const cfg = readMovement({ maxSpeed: 50, accel: 0.9, jumpJets: 'true', jetThrust: 'мусор' });
  assert.equal(cfg.maxSpeed, 50);
  assert.equal(cfg.accel, 0.9);
  assert.equal(cfg.jumpJets, true);
  assert.equal(cfg.jetThrust, movementDefaults().jetThrust, 'мусор заменён дефолтом');
  assert.equal(readMovement(undefined).maxSpeed, 34);
});

test('газ разгоняет мех, а отпускание — тормозит', () => {
  let s = fresh();
  const cfg = movementDefaults();
  for (let i = 0; i < 60; i++) s = stepMovement(s, 1 / 60, { ...IDLE, forward: 1 }, ENV, cfg);
  assert.ok(s.speed > cfg.maxSpeed / 3.6 * 0.9, 'разгоняется');
  for (let i = 0; i < 120; i++) s = stepMovement(s, 1 / 60, IDLE, ENV, cfg);
  assert.equal(s.speed, 0, 'без газа тормозит в ноль');
});

test('перегрев и блокировка режут скорость', () => {
  let s = fresh();
  const cfg = movementDefaults();
  for (let i = 0; i < 60; i++) s = stepMovement(s, 1 / 60, { ...IDLE, forward: 1 }, ENV, cfg);
  const normal = s.speed;
  for (let i = 0; i < 60; i++) s = stepMovement(s, 1 / 60, { ...IDLE, forward: 1 }, { ...ENV, overheated: true }, cfg);
  assert.ok(s.speed < normal, 'перегрев замедляет');
  const locked = stepMovement(fresh(), 0.5, { ...IDLE, forward: 1 }, { ...ENV, locked: true }, cfg);
  assert.equal(locked.speed, 0, 'при блокировке управления не двигается');
});

test('форсаж и задний ход влияют на скорость', () => {
  const cfg = movementDefaults();
  let base = fresh();
  for (let i = 0; i < 60; i++) base = stepMovement(base, 1 / 60, { ...IDLE, forward: 1 }, ENV, cfg);
  let boosted = fresh();
  for (let i = 0; i < 60; i++) boosted = stepMovement(boosted, 1 / 60, { ...IDLE, forward: 1, boost: true }, ENV, cfg);
  assert.ok(boosted.speed > base.speed, 'форсаж быстрее');
  let back = fresh();
  for (let i = 0; i < 60; i++) back = stepMovement(back, 1 / 60, { ...IDLE, forward: -1 }, ENV, cfg);
  assert.ok(Math.abs(back.speed) < Math.abs(base.speed), 'задний ход слабее');
});

test('поворот меняет курс и не телепортирует мех', () => {
  let s = fresh();
  const cfg = movementDefaults();
  const startYaw = s.yaw;
  s = stepMovement(s, 1 / 60, { ...IDLE, turn: 1 }, ENV, cfg);
  assert.ok(s.yaw > startYaw, 'курс меняется');
  assert.equal(s.speed, 0);
  const d = moveDistance(10, Math.PI / 2, 1);
  assert.ok(Math.abs(d.dx - 10) < 1e-6);
  assert.ok(Math.abs(d.dz) < 1e-6);
});

test('джеты поднимают мех и топливо тратится', () => {
  let s = fresh();
  const cfg = movementDefaults();
  for (let i = 0; i < 30; i++) s = stepMovement(s, 1 / 60, { ...IDLE, jet: true }, ENV, cfg);
  assert.equal(s.airborne, true);
  assert.ok(s.y > 0, 'поднялся');
  assert.ok(s.jetFuel < 100, 'топливо тратится');
  assert.ok(s.heat > 0, 'нагрев за джеты');
  assert.equal(s.jumping, true);
});

test('приземление гасит вертикальную скорость и даёт силу удара', () => {
  let s = { ...fresh(), airborne: true, vy: -14, y: 0.2, jetFuel: 50 };
  const cfg = movementDefaults();
  s = stepMovement(s, 1 / 60, IDLE, ENV, cfg);
  assert.equal(s.airborne, false);
  assert.equal(s.y, 0, 'встал на землю');
  assert.equal(s.vy, 0);
  assert.ok(s.landing > 0.5, 'жёсткое приземление');
});

test('после приземления топливо восстанавливается', () => {
  let s = { ...fresh(), jetFuel: 20 };
  const cfg = movementDefaults();
  for (let i = 0; i < 60; i++) s = stepMovement(s, 1 / 60, IDLE, ENV, cfg);
  assert.ok(s.jetFuel > 20, 'топливо восстановилось');
});

test('настройки оружия превращаются в слоты', () => {
  const cfg = readWeapons({ slot1: 'laser', slot2: 'none', slot3: 'missiles', slot4: 'mg', rateMul: 2 });
  assert.deepEqual(cfg.slots, ['laser', 'missiles', 'mg']);
  assert.equal(cfg.rateMul, 2);
  assert.equal(readWeapons(undefined).slots.length, 4);
  const cds = makeCooldowns(cfg);
  assert.equal(cds.length, 3);
  assert.equal(cds[0].id, 'laser');
  assert.equal(cds[0].ammo, null, 'лазер без патронов');
});

test('темп стрельбы замедляется множителем настройки', () => {
  const base = weaponsDefaults();
  const cdsFast = makeCooldowns(base);
  const cdsSlow = makeCooldowns({ ...base, rateMul: 0.5 });
  const heat: HeatState = { heat: 0, overheated: false, overheatT: 0 };
  const a = tryFireSlot(0, cdsFast, heat, base);
  const b = tryFireSlot(0, cdsSlow, heat, { ...base, rateMul: 0.5 });
  assert.equal(a.fired, true);
  assert.equal(b.fired, true);
  assert.ok(cdsSlow[0].cd > cdsFast[0].cd, 'медленнее стреляет');
  const again = tryFireSlot(0, cdsFast, heat, base);
  assert.equal(again.fired, false, 'перезарядка не даёт второй выстрел');
});

test('выстрел тратит патроны, греет и даёт залп', () => {
  const cfg = weaponsDefaults();
  const cds = makeCooldowns(cfg);
  const heat: HeatState = { heat: 0, overheated: false, overheatT: 0 };
  const r = tryFireSlot(2, cds, heat, cfg);
  assert.equal(r.fired, true);
  assert.equal(r.shot?.id, 'missiles');
  assert.ok(r.salvoCount >= 6, 'ракеты летят залпом');
  assert.equal(cds[2].ammo, WEAPONS.missiles.ammo! - WEAPONS.missiles.salvo, 'патроны убавились на размер залпа');
  assert.ok(r.heat > 0, 'нагрев вырос');
  const dry = { ...cds[2], ammo: 0 };
  cds[2] = dry;
  assert.equal(tryFireSlot(2, cds, heat, cfg).fired, false, 'без патронов не стреляет');
});

test('перегрев блокирует стрельбу и потом сбрасывается', () => {
  const cfg = { ...weaponsDefaults(), heatMul: 10 };
  const cds = makeCooldowns(cfg);
  const heat: HeatState = { heat: 0, overheated: false, overheatT: 0 };
  for (let i = 0; i < 40 && !heat.overheated; i++) {
    cds.forEach((_, s) => tryFireSlot(s, cds, heat, cfg));
    tickWeapons(1, cds, heat, cfg);
  }
  assert.equal(heat.overheated, true, 'должен перегреться');
  assert.equal(tryFireSlot(0, cds, heat, cfg).fired, false, 'в перегреве не стреляет');
  for (let i = 0; i < 2000; i++) tickWeapons(1 / 60, cds, heat, cfg);
  assert.equal(heat.overheated, false, 'остыл');
  assert.equal(heat.heat, 0);
});

test('рантайм собирает настройки типа вместе с наследованием', () => {
  const types = defaultTypes();
  const player = resolveRuntime('type_player', types);
  assert.equal(player.role, 'player');
  assert.ok(player.movement.maxSpeed > 0);
  assert.ok(player.weapons.slots.length >= 3);
  const reserve = resolveRuntime('type_reserve_mech', types);
  assert.equal(reserve.role, 'reserve');
  const missing = resolveRuntime(undefined, types);
  assert.equal(missing.role, 'neutral');
  assert.equal(missing.movement.maxSpeed, movementDefaults().maxSpeed, 'дефолт без типа');
});