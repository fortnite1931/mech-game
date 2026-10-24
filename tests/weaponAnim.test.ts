import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponRecoil } from '../src/three/weaponAnim.ts';

test('recoil pose decays back to zero — no drift accumulation over a long burst', () => {
  const r = new WeaponRecoil(8, 1.2);
  // длинная очередь MG: амплитуда насыщается, а не растёт бесконечно
  let maxAmp = 0;
  for (let i = 0; i < 500; i++) {
    r.kick(0.25);
    const p = r.update(1 / 30);
    maxAmp = Math.max(maxAmp, p.amp);
  }
  assert.ok(maxAmp <= 1.2 + 1e-9, `amp must saturate at max, got ${maxAmp}`);
  // после прекращения огня ствол возвращается в покой
  for (let i = 0; i < 400; i++) r.update(1 / 30);
  const rest = r.update(1 / 30);
  assert.ok(rest.amp < 0.005 && Math.abs(rest.pitch) < 0.005 && Math.abs(rest.back) < 0.005);
  assert.equal(r.idle, true);
});

test('pose geometry: barrels pitch up and kick back proportionally to shot strength', () => {
  const r = new WeaponRecoil(8, 1.4);
  r.kick(1.0);
  const p = r.update(0);
  assert.ok(p.pitch > 0, 'muzzle should rise');
  assert.ok(p.back > 0, 'gun should kick back');
  assert.ok(p.pitch > p.back, 'pitch dominates over linear recoil');
  // слабый выстрел пулемёта даёт меньше, чем выстрел пушки, при том же dt
  const rm = new WeaponRecoil(8, 1.4);
  rm.kick(0.18);
  const pm = rm.update(0);
  assert.ok(pm.amp < p.amp);
});

test('reset snaps to rest instantly (weapon switch / stop)', () => {
  const r = new WeaponRecoil(8, 1.4);
  r.kick(1.2);
  r.update(0.01);
  r.reset();
  const p = r.update(0);
  assert.equal(p.amp, 0);
  assert.equal(p.pitch, 0);
  assert.equal(p.back, 0);
  assert.equal(r.idle, true);
});
