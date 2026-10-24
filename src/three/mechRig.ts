/**
 * Конструктор меха: параметрический риг + скульптинг.
 *
 * Ключевой принцип: узлы называются как требует анимация (torso, head, arm_L/R,
 * leg_L/R). Поэтому любой собранный здесь мех сразу ходит, поворачивает корпус
 * и стреляет — анимация не ломается при пересборке.
 */
import * as THREE from 'three';
import { cloneMaterials } from './materials.ts';

// ======================= СПЕЦИФИКАЦИЯ =======================

export type Vec3 = [number, number, number];

export type PartId =
  | 'torso' | 'head' | 'arm_L' | 'arm_R' | 'leg_L' | 'leg_R' | 'weapon_L' | 'weapon_R';

/** Смещения вершин детали после скульптинга: индекс вершины -> [dx, dy, dz]. */
export type SculptDeltas = Record<number, [number, number, number]>;

export interface PartSpec {
  visible: boolean;
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  /** Результат скульптинга. Хранится в спецификации, а не в геометрии,
   *  чтобы переживать пересборку рига и сохраняться в файле проекта. */
  sculpt?: SculptDeltas;
}

export interface MechSpec {
  /** Общий множитель размера. */
  size: number;
  /** Ширина корпуса, м. */
  width: number;
  /** Длина корпуса, м. */
  depth: number;
  /** Обхват ног (толщина бедра), м. */
  legThick: number;
  /** Обхват рук, м. */
  armThick: number;
  /** Рост корпуса от таза до кабины, м. */
  torsoHeight: number;
  /** Длина ноги (бедро+голень), м. */
  legLength: number;
  /** Наклон корпуса вперёд, градусы. */
  torsoLean: number;
  /** Цвет брони. */
  armorColor: string;
  /** Цвет вторичных деталей. */
  accentColor: string;
  parts: Record<PartId, PartSpec>;
}

export const PART_LABELS: Record<PartId, string> = {
  torso: 'Корпус',
  head: 'Кабина',
  arm_L: 'Рука левая',
  arm_R: 'Рука правая',
  leg_L: 'Нога левая',
  leg_R: 'Нога правая',
  weapon_L: 'Оружие левое',
  weapon_R: 'Оружие правое',
};

const part = (pos: Vec3, rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): PartSpec =>
  ({ visible: true, pos, rot, scale });

export function defaultMechSpec(): MechSpec {
  return {
    size: 1, width: 2.6, depth: 1.9, legThick: 0.62, armThick: 0.5,
    torsoHeight: 2.5, legLength: 3.1, torsoLean: 6,
    armorColor: '#6b6257', accentColor: '#a8763a',
    parts: {
      torso: part([0, 5.1, 0]),
      head: part([0, 6.6, 0.25]),
      arm_L: part([-1.55, 5.7, 0], [0, 0, -5]),
      arm_R: part([1.55, 5.7, 0], [0, 0, 5]),
      leg_L: part([-0.62, 3.1, 0]),
      leg_R: part([0.62, 3.1, 0]),
      weapon_L: part([-1.85, 4.6, 1.1]),
      weapon_R: part([1.85, 4.6, 1.1]),
    },
  };
}

// ======================= СБОРКА =======================

const box = (w: number, h: number, d: number, mat: THREE.Material, name: string) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Собрать мех по спецификации. Возвращает группу с «костями» для анимации. */
export function buildMech(spec: MechSpec): THREE.Group {
  const armor = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.armorColor).getHex(), roughness: 0.62, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.accentColor).getHex(), roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.75, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff7a12, emissiveIntensity: 1.5, roughness: 0.3 });

  const g = new THREE.Group();
  g.name = 'mech_rig';

  const attach = (id: PartId, build: () => THREE.Object3D) => {
    const p = spec.parts[id];
    if (!p || !p.visible) return;
    const o = build();
    o.name = id;
    o.position.set(p.pos[0], p.pos[1], p.pos[2]);
    o.rotation.set(
      THREE.MathUtils.degToRad(p.rot[0]),
      THREE.MathUtils.degToRad(p.rot[1]),
      THREE.MathUtils.degToRad(p.rot[2]),
    );
    o.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    // запоминаем исходные вершины и возвращаем скульптинг, если он был
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const attr = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      m.userData.partId = id;
      m.userData.base = Float32Array.from(attr.array as Float32Array);
      applySculptDeltas(m, p.sculpt);
    });
    g.add(o);
  };

  // --- корпус ---
  attach('torso', () => {
    const t = new THREE.Group();
    const w = spec.width, h = spec.torsoHeight, d = spec.depth;
    const body = box(w, h, d, armor, 'chest');
    t.add(body);
    // наклонные наплечники и «юбка» — читается силуэт меха
    const pad = box(w * 0.36, h * 0.34, d * 0.9, accent, 'pad_L');
    pad.position.set(-w * 0.52, h * 0.22, 0); pad.rotation.z = 0.4; t.add(pad);
    const pad2 = pad.clone(); pad2.name = 'pad_R'; pad2.position.x = w * 0.52; pad2.rotation.z = -0.4; t.add(pad2);
    const hip = box(w * 0.8, h * 0.3, d * 0.8, dark, 'hip');
    hip.position.y = -h * 0.62; t.add(hip);
    const fin = box(0.12, h * 0.5, d * 0.5, accent, 'fin');
    fin.position.set(0, h * 0.35, -d * 0.55); t.add(fin);
    // сопло реактора сзади
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 10), dark);
    noz.name = 'nozzle'; noz.rotation.x = Math.PI / 2;
    noz.position.set(0, -h * 0.1, -d * 0.6); t.add(noz);
    t.rotation.x = -THREE.MathUtils.degToRad(spec.torsoLean);
    return t;
  });

  // --- кабина ---
  attach('head', () => {
    const h = new THREE.Group();
    const shell = box(0.9, 0.72, 1.05, armor, 'shell');
    h.add(shell);
    const visor = box(0.74, 0.24, 0.08, glass, 'visor');
    visor.position.set(0, 0.06, 0.54); h.add(visor);
    const crest = box(0.1, 0.34, 0.7, accent, 'crest');
    crest.position.set(0, 0.44, -0.05); h.add(crest);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), dark);
    antenna.name = 'antenna'; antenna.position.set(0.34, 0.6, -0.2); h.add(antenna);
    return h;
  });

  // --- руки (плечо → предплечье → кисть) ---
  const arm = (side: -1 | 1) => () => {
    const a = new THREE.Group();
    const t = spec.armThick;
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(t * 1.15, 12, 10), accent);
    shoulder.name = 'shoulder'; a.add(shoulder);
    const upper = box(t, spec.torsoHeight * 0.62, t, armor, 'upper');
    upper.position.y = -spec.torsoHeight * 0.42; a.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(t * 0.8, 10, 8), dark);
    elbow.name = 'elbow'; elbow.position.y = -spec.torsoHeight * 0.72; a.add(elbow);
    const lower = box(t * 0.9, spec.torsoHeight * 0.58, t * 0.9, armor, 'lower');
    lower.position.y = -spec.torsoHeight * 1.02; a.add(lower);
    const hand = box(t * 1.15, t * 1.15, t * 1.15, dark, 'hand');
    hand.position.y = -spec.torsoHeight * 1.36; a.add(hand);
    // стабилизатор-«палец» для читаемости силуэта
    const prong = box(t * 0.5, t * 0.5, t * 1.6, accent, 'prong');
    prong.position.set(0, -spec.torsoHeight * 1.36, t * 0.9); a.add(prong);
    a.scale.x = side;
    return a;
  };
  attach('arm_L', arm(-1));
  attach('arm_R', arm(1));

  // --- ноги (бедро → голень → стопа) ---
  const leg = (side: -1 | 1) => () => {
    const l = new THREE.Group();
    const t = spec.legThick;
    const thigh = box(t, spec.legLength * 0.52, t, armor, 'thigh');
    thigh.position.y = -spec.legLength * 0.26; l.add(thigh);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(t * 0.78, 10, 8), accent);
    knee.name = 'knee'; knee.position.y = -spec.legLength * 0.52; l.add(knee);
    const shin = box(t * 0.88, spec.legLength * 0.44, t * 0.88, armor, 'shin');
    shin.position.y = -spec.legLength * 0.74; l.add(shin);
    const foot = box(t * 1.35, t * 0.7, t * 2.1, dark, 'foot');
    foot.position.set(0, -spec.legLength * 0.96, t * 0.45); l.add(foot);
    const heel = box(t * 0.8, t * 0.9, t * 0.7, accent, 'heel');
    heel.position.set(0, -spec.legLength * 0.82, -t * 0.8); l.add(heel);
    l.scale.z = side;
    return l;
  };
  attach('leg_L', leg(-1));
  attach('leg_R', leg(1));

  // --- оружие на руках ---
  const weapon = () => () => {
    const wg = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 2.4, 10), dark);
    barrel.name = 'barrel'; barrel.rotation.x = Math.PI / 2; wg.add(barrel);
    const body = box(0.5, 0.5, 1.0, accent, 'wbody');
    body.position.z = -0.4; wg.add(body);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10), dark);
    muzzle.name = 'muzzle'; muzzle.rotation.x = Math.PI / 2; muzzle.position.z = 1.3; wg.add(muzzle);
    return wg;
  };
  attach('weapon_L', weapon());
  attach('weapon_R', weapon());

  cloneMaterials(g);
  g.scale.setScalar(spec.size);
  return g;
}

/** Наложить сохранённые смещения вершин на свежесобранную деталь. */
export function applySculptDeltas(mesh: THREE.Mesh, deltas: SculptDeltas | undefined): void {
  if (!deltas) return;
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (const key of Object.keys(deltas)) {
    const i = Number(key);
    const d = deltas[i];
    if (!d || i * 3 + 2 >= arr.length) continue;
    arr[i * 3] += d[0];
    arr[i * 3 + 1] += d[1];
    arr[i * 3 + 2] += d[2];
  }
  attr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/** Снять смещения вершин относительно исходной формы детали. */
export function captureSculptDeltas(mesh: THREE.Mesh): SculptDeltas | undefined {
  const base = mesh.userData.base as Float32Array | undefined;
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!base) return undefined;
  const arr = attr.array as Float32Array;
  const out: SculptDeltas = {};
  const count = Math.floor(base.length / 3);
  for (let i = 0; i < count; i++) {
    const dx = arr[i * 3] - base[i * 3];
    const dy = arr[i * 3 + 1] - base[i * 3 + 1];
    const dz = arr[i * 3 + 2] - base[i * 3 + 2];
    if (Math.abs(dx) > 1e-5 || Math.abs(dy) > 1e-5 || Math.abs(dz) > 1e-5) out[i] = [dx, dy, dz];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Пересобрать мех под текущие пропсы объекта (цвет/ржавчина/металл). */
export function applyLook(g: THREE.Group, tint: string, metalness: number, roughness: number): void {
  const c = new THREE.Color(tint);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of list) {
      const mat = x as THREE.MeshStandardMaterial;
      if (!mat || !('metalness' in mat)) continue;
      mat.metalness = metalness;
      mat.roughness = roughness;
    }
    void c;
  });
}

// ======================= СКУЛЬПТИНГ =======================

export type BrushMode = 'inflate' | 'deflate' | 'smooth' | 'pinch';

export interface BrushSettings {
  radius: number;
  strength: number;
  /** Насколько сильно усредняет smooth. */
  falloff: number;
}

/**
 * Кисть по вершинам: смещение вдоль нормали в радиусе кисти с мягким затуханием.
 * Работает по копии позиций, поэтому результат детерминирован и обратим назад.
 */
export function sculptMesh(mesh: THREE.Mesh, point: THREE.Vector3, s: BrushSettings, mode: BrushMode): number {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !nrm) return 0;
  if (!geo.attributes.uv2 && !mesh.userData.original) {
    mesh.userData.original = (pos.array as Float32Array).slice();
  }
  const base = (mesh.userData.original as Float32Array) ?? (pos.array as Float32Array);
  const mw = mesh.matrixWorld;
  const inv = new THREE.Matrix4().copy(mw).invert();
  const localPoint = point.clone().applyMatrix4(inv);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const r = Math.max(0.05, s.radius);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
    const d = v.distanceTo(localPoint);
    if (d > r) continue;
    touched++;
    // мягкое затухание: 1 в центре → 0 на краю
    const w = Math.pow(1 - d / r, Math.max(0.5, s.falloff));
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize();
    if (mode === 'smooth') {
      // усреднение с «базовой» формой — сглаживание шума
      p.lerp(v, w * Math.min(1, s.strength) * 0.9);
    } else if (mode === 'pinch') {
      // стягивание к центру кисти
      p.lerp(localPoint, w * Math.min(1, s.strength) * 0.6);
    } else {
      const dir = mode === 'inflate' ? 1 : -1;
      p.addScaledVector(n, dir * w * s.strength * 0.25);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  if (touched) {
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return touched;
}

/** Отменить скульптинг: вернуть исходные вершины. */
export function resetSculpt(mesh: THREE.Mesh): boolean {
  const orig = mesh.userData.original as Float32Array | undefined;
  if (!orig) return false;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return true;
}

// ======================= ПРЕСЕТЫ АССЕТОВ (собственные пропорции каждого меха) =======================

/** Зеркальная пара частей: левая ↔ правая. */
export const MIRROR_PART: Record<PartId, PartId> = {
  leg_L: 'leg_R', leg_R: 'leg_L',
  arm_L: 'arm_R', arm_R: 'arm_L',
  weapon_L: 'weapon_R', weapon_R: 'weapon_L',
  torso: 'torso', head: 'head',
};

/** Пропорции по умолчанию для каждого ассета-меха (чтобы «Ястреб» не превращался в «Титана»). */
export const MECH_DEFAULTS: Record<string, MechSpec> = {
  mech_scout: {
    size: 1, width: 2.0, depth: 1.5, legThick: 0.62, armThick: 0.55,
    torsoHeight: 1.3, legLength: 3.4, torsoLean: 0,
    armorColor: '#4a4a4a', accentColor: '#ff6a00',
    parts: {
      torso: part([0, 5.1, 0], [0, 0, 0], [1, 1, 1]),
      head: part([0, 6.6, 0.25], [0, 0, 0], [1, 1, 1]),
      arm_L: part([-1.45, 5.7, 0], [0, 0, -5], [1, 1, 1]),
      arm_R: part([1.45, 5.7, 0], [0, 0, 5], [1, 1, 1]),
      leg_L: part([-0.75, 3.1, 0], [0, 0, 0], [1, 1, 1]),
      leg_R: part([0.75, 3.1, 0], [0, 0, 0], [1, 1, 1]),
      weapon_L: part([-1.85, 4.6, 1.1], [0, 0, 0], [1, 1, 1]),
      weapon_R: part([1.85, 4.6, 1.1], [0, 0, 0], [1, 1, 1]),
    },
  },
  mech_juggernaut: {
    size: 1.15, width: 2.9, depth: 1.9, legThick: 0.9, armThick: 0.85,
    torsoHeight: 1.6, legLength: 4.0, torsoLean: 10,
    armorColor: '#3a3a3a', accentColor: '#4ad8ff',
    parts: {
      torso: part([0, 5.3, 0], [0, 0, 0], [1.25, 1.3, 1.25]),
      head: part([-0.5, 6.9, 0.25], [0, 0, 0], [1, 1, 1]),
      arm_L: part([-2.05, 5.9, 0], [0, 0, -6], [1.15, 1.1, 1.15]),
      arm_R: part([2.05, 5.9, 0], [0, 0, 6], [1.15, 1.1, 1.15]),
      leg_L: part([-0.85, 2.9, 0], [0, 0, 0], [1.25, 1.35, 1.25]),
      leg_R: part([0.85, 2.9, 0], [0, 0, 0], [1.25, 1.35, 1.25]),
      weapon_L: part([-2.15, 5.0, 1.0], [0, 0, -4], [1, 1, 1]),
      weapon_R: part([2.15, 5.0, 1.0], [0, 0, 4], [1, 1, 1]),
    },
  },
  mech_molot: {
    size: 1.05, width: 2.4, depth: 1.7, legThick: 0.75, armThick: 0.65,
    torsoHeight: 1.45, legLength: 3.7, torsoLean: 6,
    armorColor: '#5a5a5a', accentColor: '#a8763a',
    parts: {
      torso: part([0, 5.2, 0], [0, 0, 3], [1.1, 1.15, 1.15]),
      head: part([-0.35, 6.7, 0.3], [0, 0, 0], [1.05, 1.05, 1.05]),
      arm_L: part([-1.7, 5.8, 0], [0, 0, -4], [1, 1, 1]),
      arm_R: part([1.7, 5.8, 0], [0, 0, 4], [1, 1, 1]),
      leg_L: part([-0.75, 3.0, 0], [0, 0, 0], [1.1, 1.2, 1.1]),
      leg_R: part([0.75, 3.0, 0], [0, 0, 0], [1.1, 1.2, 1.1]),
      weapon_L: part([-1.85, 4.7, 1.2], [0, 0, -3], [1, 1, 1]),
      weapon_R: part([1.85, 4.7, 1.2], [0, 0, 3], [1, 1, 1]),
    },
  },
  mech_robot: {
    size: 1, width: 2.4, depth: 1.8, legThick: 0.7, armThick: 0.6,
    torsoHeight: 1.5, legLength: 3.5, torsoLean: 5,
    armorColor: '#4a4a4a', accentColor: '#a8763a',
    parts: {
      torso: part([0, 5.2, 0], [0, 0, 0], [1, 1, 1]),
      head: part([0, 6.7, 0.25], [0, 0, 0], [1, 1, 1]),
      arm_L: part([-1.55, 5.7, 0], [0, 0, -5], [1, 1, 1]),
      arm_R: part([1.55, 5.7, 0], [0, 0, 5], [1, 1, 1]),
      leg_L: part([-0.75, 3.1, 0], [0, 0, 0], [1, 1, 1]),
      leg_R: part([0.75, 3.1, 0], [0, 0, 0], [1, 1, 1]),
      weapon_L: part([-1.85, 4.6, 1.1], [0, 0, 0], [1, 1, 1]),
      weapon_R: part([1.85, 4.6, 1.1], [0, 0, 0], [1, 1, 1]),
    },
  },
};

/** Спецификация по умолчанию для ассета (чтобы каждый мех выглядел как свой). */
export function mechSpecFor(assetId: string): MechSpec {
  return MECH_DEFAULTS[assetId] ?? defaultMechSpec();
}

// ======================= БИБЛИОТЕКА ПРЕСЕТОВ ДЕТАЛЕЙ =======================

export interface PartPreset {
  id: string;
  label: string;
  partId: PartId;
  /** Частичные переопределения pos/rot/scale/visible. visible не трогаем по умолчанию. */
  spec: Partial<PartSpec>;
}

/** Пресеты ног (применяются симметрично к паре L/R). */
const legPresets: PartPreset[] = [
  { id: 'legs_light', label: 'Ноги «Легкие»', partId: 'leg_L', spec: { pos: [-0.75, 3.1, 0], rot: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 'legs_heavy', label: 'Ноги «Тяжёлые»', partId: 'leg_L', spec: { pos: [-0.85, 2.9, 0], rot: [0, 0, 0], scale: [1.25, 1.35, 1.25] } },
  { id: 'legs_long', label: 'Ноги «Длинные»', partId: 'leg_L', spec: { pos: [-0.5, 3.4, 0], rot: [0, 0, 0], scale: [0.95, 1.5, 0.95] } },
  { id: 'legs_stalk', label: 'Ноги «Пауки»', partId: 'leg_L', spec: { pos: [-1.1, 2.9, 0], rot: [8, 0, 0], scale: [0.7, 1.6, 0.7] } },
];

/** Пресеты рук. */
const armPresets: PartPreset[] = [
  { id: 'arms_cannon', label: 'Руки «Автопушка»', partId: 'arm_L', spec: { pos: [-1.55, 5.7, 0], rot: [0, 0, -5], scale: [1, 1, 1] } },
  { id: 'arms_missile', label: 'Руки «Ракетные»', partId: 'arm_L', spec: { pos: [-1.9, 5.9, 0], rot: [0, 0, -6], scale: [1.15, 1.1, 1.15] } },
  { id: 'arms_shield', label: 'Руки «Щит»', partId: 'arm_L', spec: { pos: [-1.3, 5.4, 0.9], rot: [0, 0, -4], scale: [0.9, 1.3, 0.9] } },
  { id: 'arms_smg', label: 'Руки «Пулемёт»', partId: 'arm_L', spec: { pos: [-1.2, 5.6, 0], rot: [0, 0, -4], scale: [0.85, 0.95, 0.85] } },
];

/** Пресеты корпуса. */
const torsoPresets: PartPreset[] = [
  { id: 'torso_light', label: 'Корпус «Лёгкий»', partId: 'torso', spec: { pos: [0, 5.1, 0], rot: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 'torso_heavy', label: 'Корпус «Тяжёлый»', partId: 'torso', spec: { pos: [0, 5.3, 0], rot: [0, 0, 0], scale: [1.25, 1.3, 1.25] } },
  { id: 'torso_wide', label: 'Корпус «Широкий»', partId: 'torso', spec: { pos: [0, 5.1, 0], rot: [0, 0, 0], scale: [1.4, 1.1, 1.3] } },
];

/** Пресеты кабины. */
const cabinPresets: PartPreset[] = [
  { id: 'cabin_visor', label: 'Кабина «Визор»', partId: 'head', spec: { pos: [0, 6.6, 0.25], rot: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 'cabin_sensor', label: 'Кабина «Сенсор»', partId: 'head', spec: { pos: [0, 6.9, 0.4], rot: [0, 0, 0], scale: [0.85, 1.15, 0.95] } },
  { id: 'cabin_capsule', label: 'Кабина «Капсула»', partId: 'head', spec: { pos: [0, 6.5, 0.2], rot: [0, 0, 0], scale: [1.15, 0.9, 1.15] } },
];

/** Пресеты оружия. */
const weaponPresets: PartPreset[] = [
  { id: 'weapon_gun', label: 'Оружие «Пушка»', partId: 'weapon_L', spec: { pos: [-1.85, 4.6, 1.1], rot: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 'weapon_missile', label: 'Оружие «Ракеты»', partId: 'weapon_L', spec: { pos: [-1.9, 4.8, 1.0], rot: [0, 0, -3], scale: [1.1, 0.9, 1.3] } },
  { id: 'weapon_laser', label: 'Оружие «Лазер»', partId: 'weapon_L', spec: { pos: [-1.7, 4.5, 1.3], rot: [0, 0, -2], scale: [0.9, 0.85, 1.5] } },
];

export const PART_PRESETS: PartPreset[] = [...legPresets, ...armPresets, ...torsoPresets, ...cabinPresets, ...weaponPresets];

export function presetsForPart(partId: PartId): PartPreset[] {
  return PART_PRESETS.filter((p) => p.partId === partId);
}

/** Зеркалит трансформацию правой части относительно левой. */
function mirrorSpec(spec: Partial<PartSpec>): Partial<PartSpec> {
  return {
    ...spec,
    pos: spec.pos ? [-spec.pos[0], spec.pos[1], spec.pos[2]] : undefined,
    rot: spec.rot ? [spec.rot[0], spec.rot[1], -spec.rot[2]] : undefined,
    scale: spec.scale,
    visible: spec.visible,
  };
}

/** Применить пресет к меху (с симметрией для парных частей). */
export function applyPartPreset(spec: MechSpec, preset: PartPreset): MechSpec {
  const next = { ...spec, parts: { ...spec.parts } };
  const base = { ...next.parts[preset.partId], ...preset.spec };
  next.parts[preset.partId] = base;
  const mirror = MIRROR_PART[preset.partId];
  if (mirror && mirror !== preset.partId && next.parts[mirror]) {
    next.parts[mirror] = { ...next.parts[mirror], ...mirrorSpec(preset.spec) };
  }
  return next;
}

