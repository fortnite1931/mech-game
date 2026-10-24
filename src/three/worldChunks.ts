import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { PROPS_BY_BIOME, chunkPlan, mulberry32, type WorldConfig } from './worldGen.ts';
import { interactionKind } from './interaction.ts';
import { instanceBounds, type LocalBounds } from './propPhysics.ts';
import { CollisionShape } from './collision.ts';

type PropAsset = { build: () => THREE.Group; yOffset?: number; scale?: number };
export type PropItem = { kind: string; x: number; z: number; rot: number; s: number };
type BakedPart = { geometry: THREE.BufferGeometry; material: THREE.Material };
type BakedKind = { parts: BakedPart[]; yOffset: number; scale: number };
export type PropBounds = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; radius: number };

function chunkHash(cx: number, cz: number, seed: number): number {
  let h = (Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function stripGeometry(src: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; hasUv: boolean } {
  const out = new THREE.BufferGeometry();
  const idx = src.getIndex();
  const pos = src.getAttribute('position');
  if (!pos) return { geometry: out, hasUv: false };
  if (idx) out.setIndex(idx.clone());
  let norm = src.getAttribute('normal');
  if (!norm) src.computeVertexNormals(), norm = src.getAttribute('normal');
  if (norm) out.setAttribute('normal', norm.clone());
  const uv = src.getAttribute('uv');
  const hasUv = !!uv;
  if (uv) out.setAttribute('uv', uv.clone());
  out.setAttribute('position', pos.clone());
  return { geometry: out, hasUv };
}

export class WorldChunks {
  visited = new Set<string>();
  private scene: THREE.Scene;
  private root: THREE.Group;
  private cfg: WorldConfig | null = null;
  private assets: ((id: string) => PropAsset | undefined) | null = null;
  private baked = new Map<string, BakedKind>();
  private boundsCache = new Map<string, LocalBounds>();
  private plans = new Map<string, PropItem[]>();
  private active = new Map<string, PropItem[]>();
  private instanced = new Map<string, THREE.InstancedMesh[]>();
  private promoted = new Set<PropItem>();
  private collisionCache = new WeakMap<PropItem, CollisionShape>();
  /** Очередь чанков на создание — растягиваем старт мира на несколько кадров. */
  private pending: string[] = [];
  private queued = new Set<string>();
  private dirty = false;
  private bakeBudget = 2;
  private readonly CHUNKS_PER_FRAME = 5;
  private readonly BAKES_PER_FRAME = 2;

  collisionOf(item: PropItem): CollisionShape | null {
    const existing = this.collisionCache.get(item); if (existing) return existing;
    const bk = this.bake(item.kind); if (!bk) return null;
    const s = item.s * bk.scale, ground = this.groundHeight(item.x, item.z);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(item.x, ground + bk.yOffset * s, item.z), new THREE.Quaternion().setFromAxisAngle(this.Y, item.rot), new THREE.Vector3(s, s, s));
    const shape = new CollisionShape(bk.parts.map((p) => ({ geometry: p.geometry, matrix })), ground);
    this.collisionCache.set(item, shape); return shape;
  }

  /**
   * Вернуть «ожившие» пропы обратно в лёгкие instanced-батчи, когда игрок
   * отошёл. Без этого каждый пройденный участок навсегда остаётся тяжёлым
   * объектом с тенями — кадры падают тем дальше, чем больше исходства пройдено.
   */
  release(x: number, z: number, radius: number): PropItem[] {
    const out: PropItem[] = [];
    const r2 = radius * radius;
    for (const it of this.promoted) {
      const dx = it.x - x, dz = it.z - z;
      if (dx * dx + dz * dz <= r2) continue;
      this.promoted.delete(it);
      out.push(it);
    }
    if (out.length) this.rebuild();
    return out;
  }

  /** Solid props stay baked (never promoted); callers collide against them via this query. */
  solidQuery(x: number, z: number, radius: number): PropItem[] {
    const out: PropItem[] = [];
    for (const items of this.active.values()) for (const it of items) {
      if (interactionKind(it.kind) !== 'solid') continue;
      if (Math.hypot(it.x - x, it.z - z) > radius) continue;
      out.push(it);
    }
    return out;
  }

  /**
   * World AABB for a prop instance. Local (unscaled/unrotated) AABB is cached
   * per kind; scale and yaw are applied per instance via the pure instanceBounds
   * helper, so instances of one kind with different scale/rot get correct bounds.
   */
  boundsOf(item: PropItem): PropBounds | null {
    let local = this.boundsCache.get(item.kind);
    if (!local) {
      const bk = this.bake(item.kind);
      if (!bk) return null;
      const box = new THREE.Box3();
      for (const part of bk.parts) {
        part.geometry.computeBoundingBox();
        if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
      }
      if (box.isEmpty()) return null;
      local = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, minY: box.min.y, maxY: box.max.y };
      this.boundsCache.set(item.kind, local);
    }
    const bk = this.baked.get(item.kind)!;
    const s = item.s * bk.scale;
    const y = this.groundHeight(item.x, item.z) + bk.yOffset * s;
    return { ...instanceBounds(local, item.x, item.z, y, s, item.rot), radius: Math.hypot(local.maxX - local.minX, local.maxZ - local.minZ) * s * 0.5 };
  }

  /**
   * Поднять «ожившие» пропсы из лёгких батчей в обычные объекты.
   * limit ограничивает число за один вызов: иначе разом поднимаются десятки
   * пропов и кадр проседает. Подъём дешёвый (геометрия из кэша), поэтому
   * берём побольше — иначе при большом мире очередь растёт.
   */
  takeNearby(x: number, z: number, radius: number, limit = 8): PropItem[] {
    const out: PropItem[] = [];
    for (const items of this.active.values()) for (const it of items) {
      if (out.length >= limit) return this.finishTake(out);
      if (this.promoted.has(it) || interactionKind(it.kind) === 'solid') continue;
      if (Math.hypot(it.x - x, it.z - z) > radius) continue;
      this.promoted.add(it); out.push(it);
    }
    return this.finishTake(out);
  }

  private finishTake(out: PropItem[]): PropItem[] {
    if (out.length) this.rebuild();
    return out;
  }

  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sv = new THREE.Vector3();
  private readonly Y = new THREE.Vector3(0, 1, 0);

  // без TS-параметра в конструкторе: node --test не умеет strip-only такой синтаксис
  private groundHeight: (x: number, z: number) => number;

  constructor(scene: THREE.Scene, groundHeight: (x: number, z: number) => number = () => 0) {
    this.scene = scene;
    this.groundHeight = groundHeight;
    this.root = new THREE.Group();
    this.root.name = 'world_chunks';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
  }

  setConfig(cfg: WorldConfig, assets: (id: string) => PropAsset | undefined): void {
    const changedSeed = !this.cfg || this.cfg.seed !== cfg.seed || this.cfg.chunkSize !== cfg.chunkSize ||
      this.cfg.propDensity !== cfg.propDensity || this.cfg.oasisChance !== cfg.oasisChance;
    const changedAssets = this.assets !== assets;
    this.cfg = cfg;
    this.assets = assets;
    this.clearInstances();
    this.active.clear();
    this.plans.clear();
    this.collisionCache = new WeakMap();
    if (changedSeed) { this.visited.clear(); this.promoted.clear(); this.boundsCache.clear(); }
    if (changedSeed || changedAssets) { this.disposeBaked(); }
  }

  /**
   * Обновление мира.
   *
   * Раньше все недостающие чанки (до 81 штуки) создавались за один кадр:
   * на старте превью это давало фриз 200-300 мс. Теперь чанки и виды
   * (а вид — это слияние геометрии, самая дорогая операция) добавляются
   * порциями: несколько за кадр, мир проявляется постепенно.
   */
  update(px: number, pz: number): void {
    if (!this.cfg) return;
    const r = this.radiusOverride > 0
      ? this.radiusOverride
      : Math.max(0, Math.min(10, this.cfg.worldRadius | 0));
    const cs = this.cfg.chunkSize;
    const pcx = Math.floor(px / cs);
    const pcz = Math.floor(pz / cs);
    let dirty = false;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const key = (pcx + dx) + ',' + (pcz + dz);
        if (this.active.has(key) || this.queued.has(key)) continue;
        this.queued.add(key);
        this.pending.push(key);
        dirty = true;
      }
    }
    for (const key of Array.from(this.active.keys())) {
      const p = key.split(',');
      if (Math.max(Math.abs(Number(p[0]) - pcx), Math.abs(Number(p[1]) - pcz)) > r + 1) {
        this.active.delete(key);
        dirty = true;
      }
    }
    // порция чанков за кадр
    let made = 0;
    while (this.pending.length && made < this.CHUNKS_PER_FRAME) {
      const key = this.pending.shift()!;
      this.queued.delete(key);
      if (this.active.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      // пока чанк ждал в очереди, игрок мог уйти — такой не создаём
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > r + 1) continue;
      this.active.set(key, this.planFor(cx, cz));
      made++;
    }
    this.bakeBudget = this.BAKES_PER_FRAME;
    if (dirty || made > 0 || this.dirty) { this.dirty = false; this.rebuild(); }
  }

  private planFor(cx: number, cz: number): PropItem[] {
    const cs = this.cfg?.chunkSize ?? 24;
    const key = cx + ',' + cz;
    const cached = this.plans.get(key);
    if (cached) return cached;
    let items: PropItem[] = [];
    // Мир бесконечный: ограничения по координатам нет, только кеш планов
    if (this.cfg) {
      const plan = chunkPlan(this.cfg, cx, cz);
      items = plan.props.map((p) => ({ kind: p.kind, x: p.x, z: p.z, rot: p.rot, s: p.s }));
      if (plan.biome === 'oasis') {
        const rng = mulberry32(chunkHash(cx, cz, this.cfg.seed));
        const n = 1 + (rng() < 0.5 ? 0 : 1);
        const table = PROPS_BY_BIOME.oasis;
        for (let i = 0; i < n; i++) {
          items.push({
            kind: table[Math.floor(rng() * table.length) % table.length] || 'grass',
            x: (cx + rng()) * cs, z: (cz + rng()) * cs,
            rot: rng() * Math.PI * 2, s: 0.7 + rng() * 0.8,
          });
        }
      }
    }
    this.plans.set(key, items);
    this.visited.add(key);
    return items;
  }

  private bake(kind: string): BakedKind | null {
    const existing = this.baked.get(kind);
    if (existing) return existing;
    const def = this.assets ? this.assets(kind) : undefined;
    if (!def) return null;
    const proto = def.build();
    proto.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; allUv: boolean }>();
    proto.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const src = mesh.geometry;
      const st = stripGeometry(src);
      if (!st.geometry.getAttribute('position')) return;
      st.geometry.applyMatrix4(mesh.matrixWorld);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mat = mats[0];
      if (!mat) return;
      const rec = byMat.get(mat);
      if (rec) {
        rec.geos.push(st.geometry);
        rec.allUv = rec.allUv && st.hasUv;
      } else {
        byMat.set(mat, { geos: [st.geometry], allUv: st.hasUv });
      }
    });
    const parts: BakedPart[] = [];
    for (const [mat, rec] of byMat) {
      const geos = rec.allUv ? rec.geos : rec.geos.map((g) => {
        const gg = g.clone();
        gg.deleteAttribute('uv');
        g.dispose();
        return gg;
      });
      if (geos.length === 1) parts.push({ geometry: geos[0], material: mat });
      else {
        const merged = BufferGeometryUtils.mergeGeometries(geos, false);
        geos.forEach((g) => g.dispose());
        if (merged) {
          merged.computeVertexNormals();
          merged.computeBoundingSphere();
          parts.push({ geometry: merged, material: mat });
        }
      }
    }
    if (!parts.length) return null;
    const bk: BakedKind = { parts, yOffset: def.yOffset ?? -new THREE.Box3().setFromObject(proto).min.y, scale: def.scale ?? 1 };
    this.baked.set(kind, bk);
    return bk;
  }

  /**
   * Пересобрать батчи. Меши переиспользуются: матрицы обновляются на месте,
   * буферы не пересоздаются (пересоздание = новые буферы на GPU = фриз кадра).
   */
  /**
   * Готовые (уже слитые и закешированные) части пропа.
   *
   * Баtchи рисуют инстансами, но геометрия для них уже собрана один раз на вид.
   * Поднимая проп в обычный объект, берём ту же геометрию — без пересборки
   * и без аллокаций (иначе каждый подъём съедал бы десятки геометрий в секунду).
   */
  bakedOf(kind: string): { parts: BakedPart[]; yOffset: number; scale: number } | null {
    const bk = this.bake(kind);
    return bk ? { parts: bk.parts, yOffset: bk.yOffset, scale: bk.scale } : null;
  }

  /** Сколько чанков сейчас в мире (для профайлера и тестов). */
  chunkCount() { return this.active.size; }

  /**
   * Радиус мира в чанках (0 — взять из настроек мира).
   * Движок задаёт его по видимости: мир должен существовать дальше края зрения.
   */
  private radiusOverride = 0;
  setRadius(chunks: number) { this.radiusOverride = chunks > 0 ? chunks : 0; }

  private rebuild(): void {
    const perKind = new Map<string, PropItem[]>();
    for (const items of this.active.values()) {
      for (const it of items) {
        if (this.promoted.has(it)) continue;
        let arr = perKind.get(it.kind);
        if (!arr) { arr = []; perKind.set(it.kind, arr); }
        arr.push(it);
      }
    }
    let skipped = false;
    for (const [kind, items] of perKind) {
      let bk = this.baked.get(kind);
      if (!bk) {
        // запекание вида — слияние геометрии, дорогая операция.
        // За кадр запекаем немного, остальное — в следующих кадрах.
        if (this.bakeBudget <= 0) { skipped = true; continue; }
        this.bakeBudget--;
        bk = this.bake(kind) ?? undefined;
        if (!bk) continue;
      }
      let meshes = this.instanced.get(kind);
      const need = Math.max(1, Math.ceil(items.length * 1.3) + 8);
      if (!meshes || meshes.length !== bk.parts.length || (meshes[0]?.instanceMatrix.count ?? 0) < need) {
        if (meshes) meshes.forEach((im) => { this.root.remove(im); im.dispose(); });
        meshes = bk.parts.map((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, need);
          im.name = 'wc_' + kind;
          im.castShadow = false;
          im.receiveShadow = true;
          im.matrixAutoUpdate = false;
          this.root.add(im);
          return im;
        });
        this.instanced.set(kind, meshes);
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        this.q.setFromAxisAngle(this.Y, it.rot);
        const s = it.s * bk.scale;
        this.v.set(it.x, this.groundHeight(it.x, it.z) + bk.yOffset * s, it.z);
        this.sv.set(s, s, s);
        this.m4.compose(this.v, this.q, this.sv);
        for (const im of meshes) im.setMatrixAt(i, this.m4);
      }
      for (const im of meshes) {
        im.count = items.length;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    }
    // виды, которых больше нет, убираем
    for (const [kind, meshes] of Array.from(this.instanced.entries())) {
      if (perKind.has(kind)) continue;
      meshes.forEach((im) => { this.root.remove(im); im.dispose(); });
      this.instanced.delete(kind);
    }
    this.root.updateMatrixWorld(true);
    // часть видов не успели запечь — пересоберём на следующем кадре
    if (skipped) this.dirty = true;
  }

  private clearInstances(): void {
    for (const meshes of this.instanced.values()) {
      for (const im of meshes) {
        this.root.remove(im);
        im.dispose();
      }
    }
    this.instanced.clear();
  }

  private disposeBaked(): void {
    for (const bk of this.baked.values()) {
      for (const part of bk.parts) part.geometry.dispose();
    }
    this.baked.clear();
    this.boundsCache.clear();
  }

  dispose(): void {
    this.clearInstances();
    this.disposeBaked();
    this.plans.clear();
    this.active.clear();
    this.visited.clear();
    this.promoted.clear();
    this.scene.remove(this.root);
  }
}
