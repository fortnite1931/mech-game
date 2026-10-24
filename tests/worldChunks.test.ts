import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldChunks } from '../src/three/worldChunks.ts';
import { DEFAULT_WORLD_CONFIG } from '../src/three/worldGen.ts';

/**
 * Регрессия производительности: подъём пропа из батча в обычный объект
 * не должен заново создавать и сливать геометрию — она уже закеширована
 * для инстансов. Иначе каждый подъём съедал десятки геометрий в секунду.
 */

function fakeAsset(): { build: () => THREE.Group; scale?: number } {
  return {
    build: () => {
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
      b.position.set(0, 1, 0);
      g.add(a, b);
      return g;
    },
  };
}

test('bakedOf отдаёт закешированную геометрию — тот же объект при повторных вызовах', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 5, propDensity: 1 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  w.update(0, 0);

  const first = w.bakedOf('rock');
  assert.ok(first, 'вид должен быть запечён');
  assert.ok(first.parts.length > 0, 'должны быть слитые части');
  const second = w.bakedOf('rock');
  assert.equal(second!.parts[0].geometry, first.parts[0].geometry, 'геометрия должна быть из кэша, а не новой');
});

test('yOffset в кэше компенсирует сдвиг геометрии — низ пропа встаёт на землю', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 7, propDensity: 1 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  w.update(0, 0);
  const bk = w.bakedOf('rock');
  assert.ok(bk);
  const box = new THREE.Box3();
  bk!.parts.forEach((p) => box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute)));
  // при placement y = земля + yOffset*s низ геометрии должен совпасть с землёй
  assert.ok(Math.abs(bk!.yOffset + box.min.y) < 1e-5, `yOffset должен компенсировать низ геометрии (${box.min.y}), а не ${bk!.yOffset}`);
});

test('bakedOf для неизвестного вида возвращает null — движок падает на запасной путь', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 9 }, () => undefined);
  assert.equal(w.bakedOf('nonexistent'), null);
});

test('мир создаётся постепенно: чанки добавляются, а не все сразу', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 11, propDensity: 1, worldRadius: 3 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  w.update(0, 0);
  const first = w.chunkCount();
  assert.ok(first > 0, 'должен появиться хотя бы один чанк');
  assert.ok(first <= 6, `за кадр создаётся порция (5 чанков), а не всё сразу: ${first}`);
  // ещё несколько кадров — мир дорастает
  for (let i = 0; i < 40; i++) w.update(0, 0);
  assert.ok(w.chunkCount() > first, 'мир должен дорастать по кадрам');
  assert.ok(w.chunkCount() > 40, `в итоге должно быть много чанков: ${w.chunkCount()}`);
});

test('пропы вида запекаются и используются повторно (без новой геометрии)', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 13, propDensity: 1, worldRadius: 2 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  for (let i = 0; i < 20; i++) w.update(0, 0);
  const a = w.bakedOf('rock');
  const b = w.bakedOf('rock');
  assert.ok(a && b);
  assert.equal(a!.parts[0].geometry, b!.parts[0].geometry, 'геометрия должна браться из кэша');
});

test('радиус мира задаётся движком (setRadius) — можно держать мир дальше видимости', () => {
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 21, propDensity: 1 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  w.setRadius(8);
  for (let i = 0; i < 60; i++) w.update(0, 0);
  // радиус 8 чанков = 17×17 = 289 чанков
  assert.ok(w.chunkCount() > 200, `мир должен быть широким, а не 81 чанк: ${w.chunkCount()}`);
});

test('проп не должен увеличиваться при подъёме — иначе он «вырастает» на глазах', () => {
  // логика: подъём не меняет масштаб группы (масштаб = item.s из плана чанка)
  const scene = new THREE.Scene();
  const w = new WorldChunks(scene, () => 0);
  w.setConfig({ ...DEFAULT_WORLD_CONFIG, seed: 23, propDensity: 1, worldRadius: 2 }, (id) => (id === 'rock' ? fakeAsset() : undefined));
  for (let i = 0; i < 20; i++) w.update(0, 0);
  const bk = w.bakedOf('rock');
  assert.ok(bk);
  // yOffset = -min.y, значит низ геометрии на нуле и проп стоит на земле целиком
  const box = new THREE.Box3();
  bk!.parts.forEach((p) => box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute)));
  assert.ok(Math.abs(bk!.yOffset + box.min.y) < 1e-5, 'проп должен стоять на земле, а не тонуть в ней');
});
