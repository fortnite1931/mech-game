import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionShape, STEP_CLEARANCE } from '../src/three/collision.ts';

test('low geometry below STEP_CLEARANCE is ignored by narrow-phase collision', () => {
  const lowSheet = new THREE.BoxGeometry(3, 0.2, 3);
  lowSheet.translate(0, 0.1, 0);
  const shape = new CollisionShape([{ geometry: lowSheet, matrix: new THREE.Matrix4() }], 0);
  assert.equal(shape.triangles.length, 0);
  assert.equal(shape.contact(new THREE.Vector3(0, 0, 0), 0.8), null);
});

test('rotated thin panel only collides along its actual surface and leaves AABB corners open', () => {
  const panel = new THREE.BoxGeometry(6, 2.5, 0.12);
  panel.translate(0, 1.25, 0);
  const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const shape = new CollisionShape([{ geometry: panel, matrix }], 0);

  // Corner of the enclosing AABB is empty space (off the diagonal plane).
  const openCorner = shape.contact(new THREE.Vector3(1.8, 0, 1.8), 0.6);
  assert.equal(openCorner, null);

  // Directly on the diagonal panel center produces a contact.
  const hitCenter = shape.contact(new THREE.Vector3(0, 0, 0), 0.6);
  assert.ok(hitCenter && hitCenter.depth > 0);
});

test('debug line output matches the exact collision triangles above step clearance', () => {
  const geo = new THREE.BoxGeometry(1, 2, 1);
  geo.translate(0, 1, 0);
  const shape = new CollisionShape([{ geometry: geo, matrix: new THREE.Matrix4() }], 0);
  assert.ok(STEP_CLEARANCE > 0.5);
  assert.ok(shape.triangles.length > 0);
  const lines: number[] = [];
  shape.appendLines(lines);
  assert.equal(lines.length, shape.triangles.length * 18);
});
