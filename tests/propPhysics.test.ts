import test from 'node:test';
import assert from 'node:assert/strict';
import { propProfile, blocksMovement, impactImpulse, PROP_PROFILES, STEP_OVER_HEIGHT, instanceBounds } from '../src/three/propPhysics.ts';

test('rotated slabs and differently scaled instances retain their own collision footprint', () => {
  const slab = { minX: -4, maxX: 4, minZ: -0.5, maxZ: 0.5, minY: 0, maxY: 2 };
  const turned = instanceBounds(slab, 10, 20, 3, 1, Math.PI / 2);
  assert.ok(Math.abs(turned.maxX - turned.minX - 1) < 1e-9);
  assert.ok(Math.abs(turned.maxZ - turned.minZ - 8) < 1e-9);
  const small = instanceBounds(slab, 0, 0, 0, 0.5, 0);
  const large = instanceBounds(slab, 0, 0, 0, 2, 0);
  assert.equal(small.maxX - small.minX, 4);
  assert.equal(large.maxX - large.minX, 16);
  assert.equal(large.maxY, 4);
  const offset = instanceBounds({ ...slab, minX: 1, maxX: 3 }, 0, 0, 0, 2, Math.PI / 2);
  assert.ok(Math.abs((offset.minZ + offset.maxZ) / 2 + 4) < 1e-9);
});

test('real worldGen prop ids get a light/medium/heavy classification, unknown ids default heavy-solid', () => {
  // лёгкое — отлетает от корпуса
  for (const id of ['cone', 'grass', 'crate', 'tires', 'bush']) assert.equal(propProfile(id).mass, 'light', id);
  // среднее — сдвигается с ходу
  for (const id of ['scrap', 'girder', 'barrel', 'barrel_group']) assert.equal(propProfile(id).mass, 'medium', id);
  // тяжёлое — плиты/машины/стены из PROPS_BY_BIOME + editor-объекты
  for (const id of ['slab', 'car_wreck', 'bricks', 'rails', 'husk', 'rock', 'container', 'dead_tree']) {
    assert.equal(propProfile(id).mass, 'heavy', id);
  }
  assert.equal(propProfile('mystery_asset').mass, 'heavy');
  assert.equal(propProfile('mystery_asset').kick, 0);
  // barrel prefix-обобщение
  assert.equal(propProfile('barrel_toxic').mass, 'medium');
});

test('low heavy props (rebar/rails/bricks) are stepped over, tall slabs block, light ones never block', () => {
  const footY = 0;
  // низкая арматура/рельсы — перешагивание
  assert.equal(blocksMovement(PROP_PROFILES.rails, STEP_OVER_HEIGHT - 0.1, footY), false);
  assert.equal(blocksMovement(PROP_PROFILES.bricks, 0.3, footY), false);
  // та же плита выше порога — блокирует
  assert.equal(blocksMovement(PROP_PROFILES.slab, 2.5, footY), true);
  assert.equal(blocksMovement(PROP_PROFILES.car_wreck, 1.4, footY), true);
  // лёгкие конусы/шины никогда не блокируют даже высокие
  assert.equal(blocksMovement(PROP_PROFILES.cone, 1.0, footY), false);
  assert.equal(blocksMovement(PROP_PROFILES.tires, 1.1, footY), false);
});

test('hull impulse pushes light props away from the mech along the impact direction, heavy gets nothing', () => {
  // мех в (0,0), едет +Z со скоростью 8; конус перед ним
  const cone = propProfile('cone');
  const a = impactImpulse(0, 0, 0, 8, { minX: 1.5, maxX: 2.5, minZ: 1.5, maxZ: 2.5 }, 60, cone);
  assert.ok(a.mag > 3, `light kick should be strong, got ${a.mag}`);
  // направление — от меха к конусу (нормаль ~ (0.6..0.7, 0.6..0.7))
  assert.ok(a.nx > 0.5 && a.nz > 0.5);
  // тяжёлая плита не сдвигается
  const slab = impactImpulse(0, 0, 0, 8, { minX: 2, maxX: 4, minZ: 2, maxZ: 4 }, 60, propProfile('slab'));
  assert.equal(slab.mag, 0);
  // совпадение центров — импульс идёт вдоль скорости
  const b = impactImpulse(0, 0, 5, 0, { minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2 }, 60, cone);
  assert.ok(b.nx > 0.99 && Math.abs(b.nz) < 0.01);
  // стоящий мех (speed 0) всё равно толкает лёгкое (kick-компонента от тоннажа)
  const c = impactImpulse(0, 0, 0, 0, { minX: 1, maxX: 1.4, minZ: 0, maxZ: 0.4 }, 95, cone);
  assert.ok(c.mag > 1);
});

test('squash flags: crates/cones/barrels crumple underfoot, tires and scrap only scatter', () => {
  assert.equal(propProfile('crate').squashable, true);
  assert.equal(propProfile('cone').squashable, true);
  assert.equal(propProfile('barrel').squashable, true);
  assert.equal(propProfile('tires').squashable, false, 'tires roll away instead of being destroyed');
  assert.equal(propProfile('scrap').squashable, false);
  assert.equal(propProfile('tires').rollable, true);
  assert.equal(propProfile('scrap').rollable, false);
});
