import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionKind, gaitPose } from '../src/three/interaction.ts';

test('empty barrels crush; only hazardous contents explode', () => {
  assert.equal(interactionKind('barrel'), 'crush');
  assert.equal(interactionKind('barrel_group'), 'crush');
  assert.equal(interactionKind('barrel', 'fuel'), 'explode');
  assert.equal(interactionKind('barrel_toxic'), 'explode');
  assert.equal(interactionKind('barrel_toxic', 'empty'), 'crush');
  for (const asset of ['crate', 'tires', 'scrap']) assert.equal(interactionKind(asset), 'crush');
  for (const asset of ['rock', 'bunker_wall', 'container', 'mech_scout']) assert.equal(interactionKind(asset), 'solid');
  assert.equal(interactionKind('dead_tree'), 'tree');
});

test('swing leg bends at knee and ankle keeps sole level in both directions', () => {
  for (const direction of [-1, 1]) {
    const swing = gaitPose(Math.PI / 2, 1, direction);
    const stance = gaitPose(Math.PI * 1.5, 1, direction);
    assert.ok(swing.knee > stance.knee + 0.7);
    for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
      const p = gaitPose(phase, 1, direction);
      assert.ok(p.knee >= 0 && p.knee < 1.2);
      assert.ok(Math.abs(p.hip + p.knee + p.ankle) < 1e-10);
      const idle = gaitPose(phase, 0, direction);
      assert.equal(Math.abs(idle.hip) + Math.abs(idle.knee) + Math.abs(idle.ankle), 0);
    }
  }
});
