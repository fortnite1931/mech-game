import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

export const STEP_CLEARANCE = 0.7;
export interface CollisionSource { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }

/** Actual world triangles shared by narrow phase and the debug drawing. */
export class CollisionShape {
  readonly triangles: THREE.Triangle[] = [];
  private tree = new Octree();
  constructor(sources: CollisionSource[], groundY: number) {
    for (const { geometry, matrix } of sources) {
      const p = geometry.attributes.position, index = geometry.index;
      const count = index ? index.count : p.count;
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(matrix));
        if (Math.max(...vertices.map((v) => v.y)) <= groundY + STEP_CLEARANCE) continue;
        const triangle = new THREE.Triangle(vertices[0], vertices[1], vertices[2]);
        if (triangle.getArea() < 1e-8) continue;
        this.triangles.push(triangle); this.tree.addTriangle(triangle);
      }
    }
    if (this.triangles.length) this.tree.build();
  }
  contact(position: THREE.Vector3, radius: number, height = 4) {
    if (!this.triangles.length) return null;
    const capsule = new Capsule(
      new THREE.Vector3(position.x, position.y + STEP_CLEARANCE + radius, position.z),
      new THREE.Vector3(position.x, position.y + Math.max(STEP_CLEARANCE + radius, height - radius), position.z), radius);
    return this.tree.capsuleIntersect(capsule) || null;
  }
  appendLines(out: number[]) {
    for (const t of this.triangles) for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

const cache = new WeakMap<THREE.Object3D, { key: string; shape: CollisionShape }>();
export function objectCollision(group: THREE.Object3D, groundY: number) {
  group.updateWorldMatrix(true, true);
  const sources: CollisionSource[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.collisionDebug) sources.push({ geometry: m.geometry, matrix: m.matrixWorld });
  });
  const key = groundY + sources.map((s) => s.matrix.elements.join(',')).join(';');
  const existing = cache.get(group);
  if (existing?.key === key) return existing.shape;
  const shape = new CollisionShape(sources, groundY); cache.set(group, { key, shape }); return shape;
}

export class CollisionDebug {
  private geometry = new THREE.BufferGeometry();
  private material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.65 });
  readonly lines = new THREE.LineSegments(this.geometry, this.material);
  constructor(scene: THREE.Scene) {
    this.lines.name = '__collision_debug'; this.lines.userData.collisionDebug = true;
    this.lines.raycast = () => {}; this.lines.renderOrder = 1000; this.lines.frustumCulled = false; scene.add(this.lines);
  }
  update(shapes: { shape: CollisionShape; movable: boolean }[], player?: { position: THREE.Vector3; radius: number; height: number }) {
    const vertices: number[] = [], colors: number[] = [];
    for (const { shape, movable } of shapes) {
      const start = vertices.length; shape.appendLines(vertices);
      for (let i = start; i < vertices.length; i += 3) colors.push(movable ? 0.2 : 1, movable ? 1 : 0.25, 0.15);
    }
    if (player) {
      const { position: p, radius: r, height: h } = player;
      const capsule = new THREE.CapsuleGeometry(r, Math.max(0, h - STEP_CLEARANCE - 2 * r), 4, 12);
      const edges = new THREE.EdgesGeometry(capsule), a = edges.attributes.position;
      for (let i = 0; i < a.count; i++) { vertices.push(a.getX(i) + p.x, a.getY(i) + p.y + (h + STEP_CLEARANCE) / 2, a.getZ(i) + p.z); colors.push(0.2, 0.7, 1); }
      edges.dispose(); capsule.dispose();
    }
    this.geometry.dispose(); this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); this.lines.geometry = this.geometry;
  }
  dispose() { this.lines.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
