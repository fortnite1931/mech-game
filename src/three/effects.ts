import * as THREE from 'three';
import { getTextures } from './textures.ts';
import { getSharedMaterials } from './materials.ts';

interface Fx { obj: THREE.Object3D; life: number; max: number; tick: (k: number, dt: number) => void; end?: () => void }

function radialTex(inner: string, mid: string, size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.35, mid); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function disposeObj(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((x) => { if (!x.userData.shared) x.dispose(); });
    }
  });
}
const UP = new THREE.Vector3(0, 1, 0);

// ─────────────────────────── пул частиц ───────────────────────────
// Раньше каждая вспышка искр/пыли создавала свой Points + геометрию + материал:
// десятки объектов и draw call'ов за выстрел. Теперь все частицы живут
// в двух Points-системах (аддитивная и обычная) — это 2 draw call'а на весь бой.

const PARTICLE_VS = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;      // высота вьюпорта / 2 — как у PointsMaterial
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uScale / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  // цвет НЕ домножаем на альфу: её и так использует blend-фактор
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  alpha: number;
  grav: number; drag: number;
  bounce: boolean;
  ground: number;
}

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private ps: Particle[] = [];
  private cursor = 0;
  count = 0;

  constructor(scene: THREE.Scene, capacity: number, tex: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, grow: 0, r: 1, g: 1, b: 1, alpha: 1, grav: 0, drag: 0, bounce: false, ground: 0 });
      this.pos[i * 3 + 1] = -9999; // спрятать
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScale: { value: 540 } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  /** Взять свободный слот (кольцевой буфер: старые вытесняются). */
  private take(): Particle {
    for (let i = 0; i < this.ps.length; i++) {
      const idx = (this.cursor + i) % this.ps.length;
      if (!this.ps[idx].alive) { this.cursor = (idx + 1) % this.ps.length; return this.ps[idx]; }
    }
    const p = this.ps[this.cursor];
    this.cursor = (this.cursor + 1) % this.ps.length;
    return p;
  }

  spawn(o: {
    pos: THREE.Vector3; vel: THREE.Vector3; color: number; size: number; grow?: number;
    life: number; alpha?: number; grav?: number; drag?: number; bounce?: boolean; ground?: number;
  }): void {
    const p = this.take();
    p.alive = true;
    p.x = o.pos.x; p.y = o.pos.y; p.z = o.pos.z;
    p.vx = o.vel.x; p.vy = o.vel.y; p.vz = o.vel.z;
    p.life = 0; p.max = o.life;
    p.size = o.size; p.grow = o.grow ?? 0;
    const c = new THREE.Color(o.color);
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.alpha = o.alpha ?? 1;
    p.grav = o.grav ?? 0; p.drag = o.drag ?? 0;
    p.bounce = o.bounce ?? false;
    p.ground = o.ground ?? -9999;
    this.count++;
  }

  update(dt: number, groundHeight: (x: number, z: number) => number): void {
    if (!this.count) return;
    let live = 0;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      if (!p.alive) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.alive = false; this.size[i] = 0; this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999;
        continue;
      }
      live++;
      p.vy -= p.grav * dt;
      if (p.drag > 0) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce) {
        const gy = groundHeight(p.x, p.z);
        if (p.y < gy) {
          p.y = gy;
          if (Math.abs(p.vy) < 1.2) { p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; }
          else { p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; }
        }
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size + p.grow * p.life;
      this.alpha[i] = p.alpha * (1 - k * k);
      this.color[i * 3] = p.r; this.color[i * 3 + 1] = p.g; this.color[i * 3 + 2] = p.b;
    }
    this.count = live;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.ps) p.alive = false;
    this.count = 0;
    for (let i = 0; i < this.ps.length; i++) { this.size[i] = 0; this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999; }
  }
}

// ─────────────────────────── пул обломков ───────────────────────────

interface DebrisPiece {
  mesh: THREE.Mesh;
  active: boolean;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
  rest: boolean;
  life: number;
  max: number;
  size: number;
}

const MAX_DEBRIS = 64;

export class Effects {
  private items: Fx[] = [];
  private lights: THREE.PointLight[] = [];
  private li = 0;
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo: THREE.CylinderGeometry;
  private ringGeo = new THREE.RingGeometry(0.7, 1, 28);
  private missileGeo: THREE.BufferGeometry;
  private glowTex = radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)');
  private sparkTex = radialTex('rgba(255,255,255,1)', 'rgba(255,200,120,0.6)', 32);
  private dustTex: THREE.Texture;
  private scorchMat = new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  /** Кэш материалов по цвету — снаряды и вспышки больше не создают материал каждый раз. */
  private matCache = new Map<string, THREE.MeshBasicMaterial>();
  private matCacheSpr = new Map<string, THREE.SpriteMaterial>();

  // частицы
  private addPool!: ParticlePool;
  private normPool!: ParticlePool;
  // обломки
  private debrisPool: DebrisPiece[] = [];
  // декали: одна сетка на все следы
  private decalMesh!: THREE.Mesh;
  private decalPos!: Float32Array;
  private decalN = 0;
  private readonly MAX_DECALS = 40;

  constructor(private scene: THREE.Scene, private groundHeight: (x: number, z: number) => number) {
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.cylGeo.translate(0, 0.5, 0);
    this.dustTex = getTextures().dustSprite;
    const body = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 8); body.rotateX(Math.PI / 2);
    this.missileGeo = body;
    Object.values(getSharedMaterials()).forEach((m) => { m.userData.shared = true; });
    this.scorchMat.userData.shared = true;
    for (let i = 0; i < 3; i++) {
      // ВАЖНО: свет всегда в сцене (visible = true), гасим интенсивностью.
      // Если включать/выключать visible, меняется число источников света —
      // Three.js меняет ключ кэша шейдеров и ПЕРЕКОМПИЛИРУЕТ все материалы сцены
      // (замирание на ~1 секунду на каждую вспышку выстрела).
      const l = new THREE.PointLight(0xffa040, 0, 20, 2);
      l.visible = true;
      l.intensity = 0;
      scene.add(l);
      this.lights.push(l);
    }
    // пулы частиц
    this.addPool = new ParticlePool(scene, 800, this.sparkTex, true);
    this.normPool = new ParticlePool(scene, 400, this.dustTex, false);
    // пул обломков
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const m = new THREE.Mesh(this.boxGeo, this.scorchMat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.debrisPool.push({ mesh: m, active: false, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, rest: false, life: 0, max: 1, size: 1 });
    }
    // декали одной сеткой
    this.decalPos = new Float32Array(this.MAX_DECALS * 4 * 3);
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(this.decalPos, 3));
    const didx: number[] = [];
    for (let i = 0; i < this.MAX_DECALS; i++) {
      const b = i * 4;
      didx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    dgeo.setIndex(didx);
    this.decalMesh = new THREE.Mesh(dgeo, this.scorchMat);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = 1;
    scene.add(this.decalMesh);
  }

  /** Масштаб частиц зависит от высоты вьюпорта (как у PointsMaterial). */
  setViewportHeight(h: number) {
    const s = Math.max(120, h * 0.5);
    const set = (p: THREE.Points) => {
      const m = p.material as THREE.ShaderMaterial;
      if (m.uniforms?.uScale) m.uniforms.uScale.value = s;
    };
    set(this.addPool.points);
    set(this.normPool.points);
  }

  /** Счётчики для профайлера: частицы и декали — частые виновники просадок. */
  particleCount() { return this.addPool.count + this.normPool.count + this.items.length; }
  decalCount() { return this.decalN; }

  flash(pos: THREE.Vector3, color: number, intensity: number, dur: number, dist = 20) {
    const l = this.lights[this.li++ % this.lights.length];
    l.position.copy(pos); l.color.setHex(color); l.intensity = intensity; l.distance = dist;
    l.userData = { t: 0, dur, i0: intensity };
  }

  private add(obj: THREE.Object3D, max: number, tick: Fx['tick'], end?: () => void) {
    this.scene.add(obj); this.items.push({ obj, life: 0, max, tick, end }); return obj;
  }

  /** Материал по цвету из кэша — не создаём новый материал на каждый выстрел. */
  private basicMat(color: number, opacity: number, additive: boolean): THREE.MeshBasicMaterial {
    const key = `${color}|${opacity}|${additive ? 1 : 0}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
      m.userData.shared = true;
      this.matCache.set(key, m);
    }
    return m;
  }

  private spriteMat(color: number, opacity: number, additive: boolean, tex: THREE.Texture): THREE.SpriteMaterial {
    const key = `${tex.uuid}|${color}|${opacity}|${additive ? 1 : 0}`;
    let m = this.matCacheSpr.get(key);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      m.userData.shared = true;
      this.matCacheSpr.set(key, m);
    }
    return m;
  }

  wreck(source: THREE.Group, tree: boolean, yaw: number) {
    const copy = source.clone(true);
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) { if ((o as THREE.Sprite).isSprite) o.visible = false; return; }
      m.geometry = m.geometry.clone();
      m.material = Array.isArray(m.material) ? m.material.map((v) => v.clone()) : m.material.clone();
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      materials.forEach((v) => { v.userData = { ...v.userData, shared: false }; });
      if (!tree) {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i), fold = 1 + 0.16 * Math.sin(y * 31);
          p.setXYZ(i, p.getX(i) * fold, y, p.getZ(i) * fold);
        }
        m.geometry.computeVertexNormals();
      }
    });
    const scale = copy.scale.clone(), rotation = copy.quaternion.clone();
    const baseY = new THREE.Box3().setFromObject(source).min.y;
    const axis = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let settled = false;
    const bounds = new THREE.Box3();
    this.add(copy, 45, (k) => {
      if (settled) return;
      const t = Math.min(1, k * 45 / (tree ? 0.85 : 0.22));
      if (tree) copy.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, t * Math.PI * 0.48).multiply(rotation));
      else copy.scale.copy(scale).multiply(new THREE.Vector3(1 + t * 0.3, 1 - t * 0.83, 1 + t * 0.2));
      copy.updateMatrixWorld(true);
      copy.position.y += baseY - bounds.setFromObject(copy).min.y;
      settled = t === 1;
    }, () => copy.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }));
  }

  update(dt: number) {
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      l.userData.t += dt;
      const k = l.userData.t / l.userData.dur;
      // гасим интенсивностью, а не visible: иначе пересобираются шейдеры
      if (k >= 1) l.intensity = 0; else l.intensity = l.userData.i0 * (1 - k) * (1 - k);
    }
    this.addPool.update(dt, this.groundHeight);
    this.normPool.update(dt, this.groundHeight);
    this.updateDebris(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.life += dt; const k = it.life / it.max;
      if (k >= 1) { this.scene.remove(it.obj); it.end?.(); disposeObj(it.obj); this.items.splice(i, 1); }
      else it.tick(k, dt);
    }
  }

  // ─────────── обломки: переиспользуемые меши ───────────
  private updateDebris(dt: number): void {
    for (const d of this.debrisPool) {
      if (!d.active) continue;
      d.life += dt;
      const k = d.life / d.max;
      if (k >= 1) { d.active = false; d.mesh.visible = false; continue; }
      if (!d.rest) {
        d.vy -= 22 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.ax * dt; d.mesh.rotation.y += d.ay * dt; d.mesh.rotation.z += d.az * dt;
        const gy = this.groundHeight(d.mesh.position.x, d.mesh.position.z) + d.mesh.scale.y * 0.5;
        if (d.mesh.position.y < gy) {
          d.mesh.position.y = gy;
          if (Math.abs(d.vy) < 2.5) { d.rest = true; d.vy = 0; }
          else { d.vy = -d.vy * 0.35; d.vx *= 0.6; d.vz *= 0.6; d.ax *= 0.5; d.ay *= 0.5; d.az *= 0.5; }
        }
      }
      if (k > 0.85) d.mesh.scale.multiplyScalar(Math.max(0.01, 1 - dt * 3));
    }
  }

  sprite(tex: THREE.Texture, color: number, size: number, opacity: number, additive = false) {
    const s = new THREE.Sprite(this.spriteMat(color, opacity, additive, tex));
    s.scale.set(size, size, 1);
    return s;
  }

  muzzleFlash(pos: THREE.Vector3, color: number, size = 1.4) {
    // вспышка — частица в пуле (0 draw call) + свет
    this.addPool.spawn({
      pos, vel: new THREE.Vector3(0, 0, 0), color, size, grow: size * 0.6,
      life: 0.09, alpha: 0.95, grav: 0, drag: 0,
    });
    this.flash(pos, color, 70, 0.12, 12);
  }

  /** Гильза: вылетает из ствола, крутится, звенит о землю. */
  casing(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
    const v = new THREE.Vector3(
      dir.z * 2.2 + (Math.random() - 0.5) * 1.4,
      2.4 + Math.random() * 1.2,
      -dir.x * 2.2 + (Math.random() - 0.5) * 1.4,
    );
    this.addPool.spawn({
      pos, vel: v, color: 0xd8b070, size: 0.11 * scale, life: 2.2, alpha: 0.9,
      grav: 14, drag: 0.2, bounce: true, ground: 0.05,
    });
  }

  tracer(color: number, len: number, thick = 0.07): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo, this.basicMat(color, 0.95, true));
    m.scale.set(thick, thick, len); this.scene.add(m); return m;
  }
  missile(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.missileGeo, this.basicMat(0x4a4a44, 1, false)));
    const glow = new THREE.Sprite(this.spriteMat(0xffa040, 0.9, true, this.glowTex)); glow.position.z = -0.4; g.add(glow);
    this.scene.add(g); return g;
  }
  remove(obj: THREE.Object3D) { this.scene.remove(obj); disposeObj(obj); }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const dir = new THREE.Vector3().subVectors(to, from); const len = dir.length(); dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const mk = (r: number, c: number, op: number) => {
      const m = new THREE.Mesh(this.cylGeo, this.basicMat(c, op, true));
      m.position.copy(from); m.quaternion.copy(q); m.scale.set(r, len, r); return m;
    };
    const core = mk(0.06, 0xffffff, 1), glow = mk(0.22, color, 0.55), outer = mk(0.55, color, 0.16);
    const g = new THREE.Group(); g.add(core, glow, outer);
    this.add(g, 0.4, (k) => {
      const f = 1 - k;
      core.scale.x = core.scale.z = 0.06 * f;
      glow.scale.x = glow.scale.z = 0.22 * (1 - k * 0.6);
      (core.material as THREE.MeshBasicMaterial).opacity = f;
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.55 * f;
      (outer.material as THREE.MeshBasicMaterial).opacity = 0.16 * f;
    });
    this.flash(from, color, 60, 0.25, 10);
    this.flash(to, color, 140, 0.3, 14);
    this.sparks(to, color, 14, 7);
  }

  sparks(pos: THREE.Vector3, color: number, count = 12, speed = 8, gravity = 18) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.3, (Math.random() - 0.5) * 2)
        .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.addPool.spawn({
        pos, vel: v, color, size: 0.3, life: 0.55 + Math.random() * 0.35, alpha: 1,
        grav: gravity, drag: 0.6, bounce: true,
      });
    }
  }

  dust(pos: THREE.Vector3, size = 1.5, color = 0xb08a60, life = 1.2, rise = 0.8) {
    const p = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.4, pos.y, pos.z + (Math.random() - 0.5) * 0.4);
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, rise, (Math.random() - 0.5) * 0.8);
    this.normPool.spawn({ pos: p, vel: v, color, size, grow: size * 1.6, life, alpha: 0.55, drag: 1.2 });
  }

  smoke(pos: THREE.Vector3, size = 1.5, life = 2.2, color = 0x2a2420) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6);
    this.normPool.spawn({ pos: pos.clone(), vel: v, color, size, grow: size * 2.2, life, alpha: 0.5, drag: 1.1 });
  }

  ring(pos: THREE.Vector3, size: number, color = 0xffc080) {
    const m = new THREE.Mesh(this.ringGeo, this.basicMat(color, 0.7, true));
    m.position.set(pos.x, this.groundHeight(pos.x, pos.z) + 0.12, pos.z); m.rotation.x = -Math.PI / 2; m.scale.setScalar(size * 0.3);
    this.add(m, 0.45, (k) => { m.scale.setScalar(size * (0.3 + k * 2.5)); (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k); });
  }

  debris(pos: THREE.Vector3, count: number, size: number, mat: THREE.Material, speed = 9) {
    for (let i = 0; i < count; i++) {
      const d = this.debrisPool.find((x) => !x.active);
      if (!d) return;
      d.active = true; d.rest = false; d.life = 0; d.max = 3.5 + Math.random() * 1.5;
      const s = size * (0.4 + Math.random());
      d.mesh.material = mat;
      d.mesh.scale.set(s, s * (0.6 + Math.random() * 0.8), s * (0.5 + Math.random()));
      d.mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * size, Math.random() * size * 0.5, (Math.random() - 0.5) * size));
      d.vx = (Math.random() - 0.5) * 2 * speed * (0.5 + Math.random() * 0.8);
      d.vy = (0.8 + Math.random() * 1.4) * speed * 0.5;
      d.vz = (Math.random() - 0.5) * 2 * speed * (0.5 + Math.random() * 0.8);
      d.ax = (Math.random() - 0.5) * 9; d.ay = (Math.random() - 0.5) * 9; d.az = (Math.random() - 0.5) * 9;
      d.mesh.visible = true;
    }
  }

  /** Взрыв: огненный шар, дым, искры, обломки, след на земле.
   *  Всё через пулы — несколько вызовов не создают объектов. */
  explosion(pos: THREE.Vector3, size: number, opts: { fire?: boolean; debrisMat?: THREE.Material; debris?: number } = {}) {
    this.flash(pos, 0xffb060, 120 * size, 0.28, 16);
    // огненный шар
    const n = Math.round(8 + size * 6);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.4, (Math.random() - 0.5) * 2)
        .normalize().multiplyScalar(size * 3 * (0.3 + Math.random()));
      this.addPool.spawn({
        pos, vel: v, color: i % 3 === 0 ? 0xfff0c0 : 0xff8030,
        size: size * 0.55, grow: size * 0.7, life: 0.3 + Math.random() * 0.22, alpha: 0.95, drag: 2.4,
      });
    }
    // дым
    for (let i = 0; i < Math.round(3 + size * 2); i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2);
      this.normPool.spawn({
        pos: pos.clone(), vel: v, color: 0x2a2420, size: size * 0.7, grow: size * 1.4,
        life: 1.4 + Math.random(), alpha: 0.55, drag: 1.1,
      });
    }
    this.sparks(pos, 0xffc070, Math.round(10 + size * 6), 9);
    if (opts.debris) this.debris(pos, opts.debris, size * 0.4, opts.debrisMat ?? this.scorchMat, 9);
    this.ring(pos, size * 1.6, 0xffb060);
    this.scorch(pos, size * 0.9);
  }

  /** Реактивное пламя джетпака: конус аддитивных частиц назад по движению. */
  jet(pos: THREE.Vector3) {
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, -1.5 - Math.random() * 2.2, (Math.random() - 0.5) * 1.6);
      this.addPool.spawn({
        pos, vel: v, color: i === 0 ? 0xfff2c0 : 0xff9040,
        size: 0.22, grow: 0.3, life: 0.16 + Math.random() * 0.12, alpha: 0.9, drag: 1.6,
      });
    }
    this.normPool.spawn({
      pos: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.8, (Math.random() - 0.5) * 0.6),
      color: 0x6a6058, size: 0.5, grow: 0.8, life: 0.6, alpha: 0.4, drag: 1.4,
    });
  }

  /** След от попадания: все следы — одна сетка (1 draw call вместо 40). */
  scorch(pos: THREE.Vector3, radius: number) {
    if (this.decalN >= this.MAX_DECALS) {
      // вытесняем самый старый: сдвигаем данные на одну декаль
      this.decalPos.copyWithin(0, 12);
      this.decalN = this.MAX_DECALS - 1;
    }
    const i = this.decalN;
    const b = i * 12;
    const gy = this.groundHeight(pos.x, pos.z) + 0.04;
    const a = Math.random() * Math.PI * 2;
    const c = Math.cos(a) * radius, s = Math.sin(a) * radius;
    this.decalPos[b + 0] = pos.x - c; this.decalPos[b + 1] = gy; this.decalPos[b + 2] = pos.z - s;
    this.decalPos[b + 3] = pos.x + c; this.decalPos[b + 4] = gy; this.decalPos[b + 5] = pos.z + s;
    this.decalPos[b + 6] = pos.x + c; this.decalPos[b + 7] = gy; this.decalPos[b + 8] = pos.z + s;
    this.decalPos[b + 9] = pos.x - c; this.decalPos[b + 10] = gy; this.decalPos[b + 11] = pos.z + s;
    this.decalN++;
    (this.decalMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.decalMesh.geometry.setDrawRange(0, this.decalN * 6);
  }

  dispose() {
    this.addPool.points.geometry.dispose();
    this.normPool.points.geometry.dispose();
    this.decalMesh.geometry.dispose();
  }
}

// ─────────────────────────── пост-обработка ───────────────────────────
// Ночное и тепловое зрение: сцена рисуется в буфер, потом на весь экран
// идёт один полноэкранный пасс с шейдером.

const POST_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FS = `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform int uMode;      // 1 — ночное, 2 — тепловое
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  // лёгкое дрожание сигнала
  float n = hash(uv * 320.0 + uTime * 8.0);
  vec2 jitter = vec2(n - 0.5, hash(uv * 271.0 + uTime * 5.0) - 0.5) * 0.0025;
  vec3 c = texture2D(tDiffuse, uv + jitter).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 outc;
  if (uMode == 1) {
    // ночное: зелёный монохром + усиление шума
    float g = pow(l, 0.85) * 1.5;
    outc = vec3(0.05, g * 0.95, g * 0.45) + n * 0.05;
  } else {
    // тепловое: палитра по яркости
    float h = clamp(l * 1.35, 0.0, 1.0);
    vec3 cold = vec3(0.02, 0.0, 0.18);
    vec3 mid  = vec3(0.55, 0.05, 0.45);
    vec3 hot  = vec3(1.0, 0.55, 0.08);
    vec3 max  = vec3(1.0, 0.98, 0.85);
    outc = mix(cold, mid, smoothstep(0.0, 0.42, h));
    outc = mix(outc, hot, smoothstep(0.42, 0.78, h));
    outc = mix(outc, max, smoothstep(0.78, 1.0, h));
  }
  // виньетка
  float d = length(vUv - 0.5);
  float vig = smoothstep(0.85, 0.3, d);
  outc *= 0.35 + 0.65 * vig;
  gl_FragColor = vec4(outc, 1.0);
}`;

export class PostFX {
  private rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: true,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uMode: { value: 1 } },
      vertexShader: POST_VS,
      fragmentShader: POST_FS,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(2, w), Math.max(2, h));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mode: number, time: number) {
    this.mat.uniforms.uMode.value = mode;
    this.mat.uniforms.uTime.value = time;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose() { this.rt.dispose(); this.mat.dispose(); }
}
