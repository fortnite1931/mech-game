import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Effects } from './effects.ts';
import { sfx } from './sfx.ts';
import { getSharedMaterials } from './materials.ts';
import { WEAPONS, CHASSIS, VIEW_ORDER, VISION_ORDER } from './playTypes.ts';
import type { MechConfig, ViewMode, VisionMode, HudState, WeaponDef, Scenario, EnemyKindId } from './playTypes.ts';
import { Enemy } from './enemies.ts';
import { WorldChunks, type PropItem } from './worldChunks.ts';
import { findSpawn } from './worldGen.ts';
import type { ZoneDef } from './worldGen.ts';
import type { WorldConfig } from './worldGen.ts';
import { getAsset, type MechAnimState } from './assets.ts';
import { interactionKind, type BarrelContents } from './interaction.ts';
import { animateLeg } from './mechGait.ts';
import { getPilotModel, getPilotAnimationClips, clonePilot } from './pilotModel.ts';
import { applyIdleSway } from './idleSway.ts';
import { WeaponRecoil } from './weaponAnim.ts';
import { CollisionDebug, objectCollision, type CollisionShape } from './collision.ts';
import {
  movementDefaults, makeCooldowns, moveDistance, stepMovement, tickWeapons, tryFireSlot, weaponsDefaults,
  type MovementSettings, type MovementState, type WeaponCooldown, type WeaponsSettings, type HeatState,
} from './runtime/index.ts';
import {
  propProfile, impactImpulse,
  PROP_DAMPING, PROP_GRAVITY, PROP_BOUNCE,
} from './propPhysics.ts';
import { Inventory, rollLoot, craft, canCraft, ITEMS, type ItemId } from '../game/playerKit.ts';

export interface PlayTarget { id: string; group: THREE.Group; name: string; category: string; assetId: string; role: string; contents?: BarrelContents }
export interface PlayHost {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; dom: HTMLCanvasElement;
  groundHeight(x: number, z: number): number;
  updateWorldGround?(x: number, z: number): void;
  getTargets(): PlayTarget[];
  destroyTarget(id: string): void;
  spawnEnemy(assetId: string, x: number, z: number): THREE.Group | null;
  /** Дальность, за которой объекты уже не видно (из тумана) — для подгрузки «незаметно». */
  viewDistance?(): number;
}
export interface PlayCallbacks {
  onHud: (h: HudState) => void;
  onPointer: (x: number, y: number, visible: boolean) => void;
  onExit: () => void;
}

interface Target extends PlayTarget { box: THREE.Box3; center: THREE.Vector3; hp: number; maxHp: number; meshes: THREE.Mesh[]; radius: number; solid: boolean; enemy?: Enemy; transient?: boolean }
interface EnemyProj { mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; dmg: number; life: number; shooter?: THREE.Object3D }

/**
 * Слить меши пропа по материалам.
 *
 * Проп из библиотеки — это группа из 8-40 мешей (каждая = отдельный draw call).
 * 64 пропа давали ~500 вызовов отрисовки — потолок по FPS. Сливаем по материалу:
 * 8-40 мешей превращаются в 2-4. Материалы остаются общими (без клонирования),
 * поэтому GPU компилирует один набор шейдеров.
 */
function mergePropMeshes(group: THREE.Group): THREE.Group {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let hasNonMesh = false;
  let meshCount = 0;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) { if ((o as THREE.Sprite).isSprite || (o as THREE.Light).isLight) hasNonMesh = true; return; }
    meshCount++;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const list = byMat.get(mat);
    if (list) list.push(g); else byMat.set(mat, [g]);
  });
  // спрайты/света не сливаем — их нельзя положить в одну геометрию
  if (hasNonMesh || meshCount < 2) return group;

  // ФАЗА 1: сливаем во временные геометрии. Исходные не трогаем до успеха.
  const temps: { mat: THREE.Material; geo: THREE.BufferGeometry }[] = [];
  let failed = false;
  for (const [mat, geos] of byMat) {
    let geo: THREE.BufferGeometry | null = null;
    try { geo = mergeGeometries(geos, false); } catch { geo = null; }
    if (!geo) { failed = true; break; }
    temps.push({ mat, geo });
  }
  if (failed) {
    temps.forEach((t) => t.geo.dispose());
    byMat.forEach((geos) => geos.forEach((g) => g.dispose()));
    return group; // осталось как было
  }

  // ФАЗА 2: всё слилось — собираем новую группу и освобождаем исходные геометрии
  const out = new THREE.Group();
  temps.forEach(({ mat, geo }) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  });
  byMat.forEach((geos) => geos.forEach((g) => g.dispose()));
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  return out;
}
interface Slot { def: WeaponDef; ammo: number | null; cd: number }
interface Proj { mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; def: WeaponDef; life: number; homing: THREE.Vector3 | null; trail: number; kind: 'projectile' | 'missile' }
/** A world prop promoted to a live physics body (pushed, kicked, squashed). */
interface LooseProp {
  target: Target;
  vx: number; vz: number; vy: number;
  spin: number;          // yaw spin rate (rad/s)
  airborne: boolean;
  yaw: number;
  baseScale: number;
}

const HP_BY_CAT: Record<string, number> = { 'Мехи': 260, 'Укрытия': 140, 'Бочки и грузы': 30, 'Металлолом': 70, 'База и техника': 110, 'Ландшафт': 50 };
/** Длительность плавного появления нового объекта мира, с. */
const HP_BY_ASSET: Record<string, number> = { rock: Infinity, dead_tree: 25, barrel: 25, barrel_group: 45, barrel_toxic: 30, container: 180, crate: 20, tires: 40 };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** [id, count] для каждого предмета — для компактных сообщений в журнале. */
function uniqCount(ids: ItemId[]): [ItemId, number][] {
  const m = new Map<ItemId, number>();
  ids.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const clamp = THREE.MathUtils.clamp;
const damp = (a: number, b: number, l: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-l * dt));

/** Является ли узел потомком корня (нужно, чтобы не ловить снаряд своей же моделью). */
function isChildOf(obj: THREE.Object3D, root: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o === root) return true;
    o = o.parent;
  }
  return false;
}

export class PlayController {
  // input
  private keys = new Set<string>();
  private mmb = false; private lmb = false; private rmb = false;
  private ndc = new THREE.Vector2(0, 0);
  private lastMouse = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  // mech parts
  private torso: THREE.Object3D | null = null;
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private muzzles: THREE.Object3D[] = [];
  private missileMuzzles: THREE.Object3D[] = [];
  private chassisInfo;
  private footOffset = 0;
  // state
  private pos = new THREE.Vector3();
  private legYaw = 0; private torsoOffset = 0; private lookYaw = 0; private lookPitch = 0; private armPitch = 0;
  private speed = 0; private airborne = false; private jetFuel = 100; private jetT = 0; private jetSfxT = 0;
  private legPhase = 0; private lastStep = 0; private moveRatio = 0; private bob = 0; private maxSpeedNow = 1;
  private heat = 0; private overheated = false; private overheatT = 0;
  private slots: Slot[] = []; private selected = 0; private salvoQueue: { slot: number; t: number }[] = [];
  view: ViewMode; vision: VisionMode;
  private camYaw = 0; private camPitch = 0.42; private camDist = 12; private fovZoom = 1;
  private camPosCur = new THREE.Vector3(); private camLookCur = new THREE.Vector3(); private camInit = false;
  private shake = 0;
  private projectiles: Proj[] = [];
  private targets: Target[] = [];
  private targetMeshes: THREE.Mesh[] = [];
  private destroyQueue: Target[] = [];
  private aimPoint = new THREE.Vector3(); private aimTarget: Target | null = null;
  private enemies: Enemy[] = [];
  private eproj: EnemyProj[] = [];
  private php = 100; private pmax = 100;
  private waveIdx = -1; private waveT = 0; private winT = 0;
  private over: null | 'won' | 'lost' = null;
  private hurt = 0;
  private kills = 0; private shots = 0; private log: string[] = [];
  private hudT = 0; private time = 0; private showHelp = true;
  private fx: Effects;
  private muzzleIdx = 0;
  private world: WorldChunks | null = null;
  private worldT = 0;
  private loose: LooseProp[] = [];
  private recoil: WeaponRecoil[] = [];
  private missileRecoil: WeaponRecoil[] = [];
  private missilePods: THREE.Object3D[] = [];
  private cannons: THREE.Object3D[] = [];
  private servoT = 0;
  private worldId = 0;
  tuning = false;
  ejected = false;
  /** id шасси текущего меха (нужен, чтобы вернуться в свой мех после выхода). */
  private chassisAsset = 'mech_scout';
  /** Мех, из которого пилот вышел — в том числе созданный (его нет в списке объектов сцены). */
  private lastMech: { group: THREE.Group; id: string | null; assetId: string } | null = null;
  /** Видимый пилот-аватар (строится при выходе из меха). */
  private pilot: THREE.Group | null = null;
  private pilotLegs: THREE.Object3D[] = [];
  /** Кольцо-подсветка ближайшего меха, чтобы было видно, куда садиться. */
  private marker: THREE.Mesh | null = null;
  private markerT = 0;
  /** Объекты мира, которые сейчас «проявляются» — плавно, чтобы не было щелчков. */
  /** Живые пропы мира: предмет → его объект и цель (для утилизации вдали). */
  private worldProps = new Map<PropItem, { group: THREE.Group; target: Target }>();
  /** Скорость пилота на земле (м/с) — для разгона и анимации шага. */
  private pilotVel = new THREE.Vector3();
  /** Выносливость: тратится на бег, восстанавливается в покое. */
  private stamina = 100;
  /** Инвентарь игрока — наполняется из разрушенных объектов. */
  readonly inventory: Inventory;
  /** Сейчас игрок бежит (для расхода выносливости). */
  private runningNow = false;

  private pilotArms: THREE.Object3D[] = [];
  /** Насколько опустить модель, чтобы ступни стояли на земле (box.min.y модели). */
  private pilotFootDrop = 0;
  /** AnimationMixer для пилота (клипы из Pilot_Anim.glb: Walk/Run_Anime/Climb_Wall/Fixing_Kneeling). */
  private pilotMixer: THREE.AnimationMixer | null = null;
  private pilotAction: THREE.AnimationAction | null = null;
  private pilotClipName: string | null = null;
  /** Скорости анимаций пилота (панель «Анимации») и ручные назначения клипов. */
  private pilotSpeeds = { walk: 1, run: 1, jump: 1, idle: 1, global: 1 };
  private pilotClipMap: Partial<Record<string, string>> | null = null;
  /** Вкарабкивание в мех: цель, в которую сядем, когда клип доиграет. */
  /** Подкарабкивание в мех: цель, в которую и летит, и когда влезаем. */
  private pendingSeat: { id: string; group: THREE.Group; assetId: string } | null = null;
  /** Автоподход к меху: пилот сам идёт/бежит до кабины, потом вкарабкивается. */
  private seatApproach: { id: string; group: THREE.Group; assetId: string } | null = null;
  /** Первый выход пешком — стартуем от места поставленного пилота, без переносов. */
  private footFromPilot = false;
  private climbT = 0;
  private climbMax = 1;
  /** Старт и цель вкарабкивания: пилот лезет вдоль борта вверх, к кабине. */
  private climbStart: { x: number; y: number; z: number } | null = null;
  private climbGoal: { x: number; y: number; z: number } | null = null;
  /** Последний вызов startClimb — для перезапуска, когда догрузятся клипы. */
  private climbPending: { id: string | undefined; group: THREE.Group; assetId: string } | null = null;
  private climbHasClip = false;
  /** Зоны карты (цели зачистки). */
  private zoneDefs: ZoneDef[] = [];
  private zoneSpawned = new Set<string>();
  /** Принадлежность врага зоне. */
  private enemyZone = new WeakMap<Enemy, string>();

  /** Модель пилота ещё не догрузилась — стоит процедурный запасной силуэт. */
  private pilotIsFallback = false;

  /**
   * Пилот: модель из Pilot_Anim.glb (скелет + 4 клипа: Walk/Run_Anime/Climb_Wall/Fixing_Kneeling).
   * Анимация шага/бега идёт через AnimationMixer по скелету. Если модель ещё
   * грузится — процедурный силуэт, а при догрузке модель подменяется.
   */
  private buildPilot(): THREE.Group {
    const clone = clonePilot();
    if (clone) {
      this.pilotIsFallback = false;
      clone.userData.sharedGeo = true; // геометрия общая с кэшем — disposeTree её не тронет
      const box = new THREE.Box3().setFromObject(clone);
      this.pilotFootDrop = box.min.y;
      return clone;
    }
    this.pilotIsFallback = true;
    return this.buildPilotFallback();
  }

  /**
   * Пилот в защитном костюме: скруглённые формы, наплечники, шлем с визором,
   * ранец. Рост ~1.8 м. Руки и ноги вращаются от суставов при ходьбе.
   */
  private buildPilotFallback(): THREE.Group {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x37424a, roughness: 0.78, metalness: 0.2 });
    const suitDark = new THREE.MeshStandardMaterial({ color: 0x232b31, roughness: 0.85, metalness: 0.15 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x7a6136, roughness: 0.5, metalness: 0.5 });
    const visor = new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff7a12, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.1 });

    const capsule = (r: number, len: number, mat: THREE.Material) =>
      new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);

    // таз и торс — скруглённые капсулы
    const hips = capsule(0.2, 0.14, suitDark);
    hips.position.y = 0.92;
    hips.castShadow = true;
    g.add(hips);

    const torso = capsule(0.23, 0.34, suit);
    torso.position.y = 1.26;
    torso.scale.z = 0.82;
    torso.castShadow = true;
    g.add(torso);

    // нагрудная плита
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.16), plate);
    chest.position.set(0, 1.31, 0.16);
    chest.castShadow = true;
    g.add(chest);
    // пояс
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.28), plate);
    belt.position.y = 1.02;
    g.add(belt);
    // ранец
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), suitDark);
    pack.position.set(0, 1.3, -0.24);
    pack.castShadow = true;
    g.add(pack);
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 3, 8), plate);
    tank.position.set(-0.11, 1.34, -0.36);
    g.add(tank);
    const tank2 = tank.clone();
    tank2.position.x = 0.11;
    g.add(tank2);

    // шея + шлем
    const neck = capsule(0.07, 0.05, suitDark);
    neck.position.y = 1.56;
    g.add(neck);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), suit);
    helm.position.y = 1.7;
    helm.scale.set(1, 1.08, 1.06);
    helm.castShadow = true;
    g.add(helm);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10, -0.9, 1.8, 0.75, 0.9), visor);
    glass.position.set(0, 1.7, 0.05);
    g.add(glass);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.12), plate);
    fin.position.set(0, 1.82, -0.06);
    g.add(fin);

    // ноги: пивот в бедре, капсула смещена вниз
    this.pilotLegs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.12 * side, 0.88, 0);
      const thigh = capsule(0.095, 0.3, suit);
      thigh.position.y = -0.26;
      thigh.castShadow = true;
      pivot.add(thigh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.28), suitDark);
      boot.position.set(0, -0.46, 0.04);
      boot.castShadow = true;
      pivot.add(boot);
      g.add(pivot);
      this.pilotLegs.push(pivot);
    }

    // руки: пивот в плече, капсула вниз + наплечник
    this.pilotArms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.27 * side, 1.47, 0);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), plate);
      shoulder.castShadow = true;
      pivot.add(shoulder);
      const arm = capsule(0.07, 0.26, suit);
      arm.position.y = -0.24;
      arm.castShadow = true;
      pivot.add(arm);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.13), suitDark);
      glove.position.y = -0.44;
      pivot.add(glove);
      g.add(pivot);
      this.pilotArms.push(pivot);
    }

    g.name = '__pilot__';
    // начало модели — на уровне таза; запоминаем, насколько опустить до стоп
    const box = new THREE.Box3().setFromObject(g);
    this.pilotFootDrop = box.min.y;
    return g;
  }

  /** Кольцо под ближайшим доступным мехом. */
  private buildMarker(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.1, 32),
      new THREE.MeshBasicMaterial({ color: 0x6ad4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.name = '__seat_marker__';
    return ring;
  }
  private collisionDebug: CollisionDebug | null = null;
  private debugT = 0;
  // --- поведения (Ф2): правила движения и оружия приходят из типа объекта ---
  private moveCfg = movementDefaults();
  private weaponCfg = weaponsDefaults();
  private slotCds: WeaponCooldown[] = [];
  private moveState: MovementState;
  private previousPosition = new THREE.Vector3();
  setCollisionDebug(enabled: boolean) {
    if (enabled && !this.collisionDebug) this.collisionDebug = new CollisionDebug(this.host.scene);
    if (!enabled) { this.collisionDebug?.dispose(); this.collisionDebug = null; }
    this.debugT = 1;
  }
  private collisionShapes(): { shape: CollisionShape; movable: boolean }[] {
    const shapes: { shape: CollisionShape; movable: boolean }[] = [];
    for (const t of this.targets) {
      if (t.hp <= 0 || t.role === 'spawn' || t.box.distanceToPoint(this.pos) > 30) continue;
      shapes.push({ shape: objectCollision(t.group, this.host.groundHeight(t.center.x, t.center.z)), movable: propProfile(t.assetId).mass !== 'heavy' || t.assetId === 'dead_tree' });
    }
    for (const item of this.world?.solidQuery(this.pos.x, this.pos.z, 30) ?? []) {
      const shape = this.world!.collisionOf(item); if (shape) shapes.push({ shape, movable: false });
    }
    return shapes;
  }

  setConfig(cfg: MechConfig) { this.cfg = cfg; sfx.enabled = cfg.sfx; }

  /** Временная админка: ручная балансировка (скорости, урон, множители). */
  balance = { mechSpeed: 1, pilotWalk: 1, pilotRun: 1, dmgFromPlayer: 1, dmgToPlayer: 1 };
  setBalance(patch: Partial<typeof this.balance>) { Object.assign(this.balance, patch); }
  setEnemyMults(hpMul: number, dmgMul: number) {
    this.scenario.enemyHpMul = hpMul;
    this.scenario.enemyDmgMul = dmgMul;
  }
  /** Текущие зоны карты (для админки). */
  getZones(): ZoneDef[] { return this.zoneDefs.slice(); }
  /** Переопределить зоны на лету (админка). */
  setZones(list: ZoneDef[]) {
    this.zoneDefs = list.slice();
    this.zoneSpawned.clear();
  }

  /** Настройки поведений типа объекта — перекрывают MechConfig в превью. */
  setRuntime(rt: { movement: MovementSettings; weapons: WeaponsSettings }) {
    this.moveCfg = rt.movement;
    this.weaponCfg = rt.weapons;
    this.slots = makeCooldowns(rt.weapons).map((c) => ({ def: WEAPONS[c.id], ammo: c.ammo, cd: 0 }));
    while (this.slots.length < 4) this.slots.push({ def: WEAPONS.none, ammo: null, cd: 0 });
    this.slotCds = makeCooldowns(rt.weapons);
  }

  constructor(
    private host: PlayHost,
    private cfg: MechConfig,
    private cb: PlayCallbacks,
    private mech: THREE.Group,
    chassisId: string,
    private ownId: string | null,
    private scenario: Scenario,
    private worldCfg: WorldConfig | null = null,
    /** Персонаж из сцены, которого контролируем пешком (null — временная фигурка). */
    private pilotObj: THREE.Group | null = null,
    /** id сценного персонажа — чтобы тянуть его настройки анимаций. */
    private pilotObjId: string | null = null,
  ) {
    this.chassisInfo = CHASSIS[chassisId] || CHASSIS.mech_scout;
    this.chassisAsset = CHASSIS[chassisId] ? chassisId : 'mech_scout';
    this.inventory = new Inventory(cfg.vitals.carryKg);
    this.stamina = cfg.vitals.stamina;
    this.view = cfg.defaultView;
    this.vision = cfg.defaultVision;
    this.fx = new Effects(host.scene, (x, z) => host.groundHeight(x, z));
    // модель пилота грузится один раз на всё приложение
    // модель грузится при импорте pilotModel.ts
    this.moveState = {
      speed: 0, vy: 0, y: this.mech.position.y, yaw: this.mech.rotation.y,
      airborne: false, jetFuel: 100, heat: 0, landing: 0, jumping: false,
    };
    this.ejected = false;
    // масштаб частиц зависит от высоты вьюпорта
    this.fx.setViewportHeight(this.host.dom.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  /**
   * Граница перемещения. В конечной сцене (±120 м) не даём уехать с площадки,
   * в бесконечном мире ограничиваем только на absurd-уровне — чтобы ловить
   * возможные NaN/рассинхрон, но не ставить игроку искусственную стену.
   */
  private get limit(): number {
    return this.worldCfg && this.worldCfg.enabled !== false ? 50000 : 108;
  }

  /** Поставить позицию внутрь допустимых границ. */
  private boundXZ(v: THREE.Vector3): void {
    const L = this.limit;
    v.x = clamp(v.x, -L, L);
    v.z = clamp(v.z, -L, L);
    // карта с границами: не выпускаем за радиус мира (за ним — горы/вода/лес)
    const R = this.worldCfg && this.worldCfg.worldRadius > 0 ? this.worldCfg.worldRadius * 1000 : 0;
    if (R > 0) {
      const d = Math.hypot(v.x, v.z);
      if (d > R) { const k = R / d; v.x *= k; v.z *= k; }
    }
  }

  // ======================= lifecycle =======================
  start() {
    const m = this.mech;
    m.traverse((o) => {
      if (o.name === 'torso') this.torso = o;
      else if (o.name === 'leg_L') this.legs[0] = o;
      else if (o.name === 'leg_R') this.legs[1] = o;
      else if (o.name === 'arm_L' || o.name === 'arm_R') this.arms.push(o);
      else if (o.name === 'muzzle') this.muzzles.push(o);
      else if (o.name === 'muzzle_missile') this.missileMuzzles.push(o);
    });
    if (!this.muzzles.length) { const f = new THREE.Object3D(); f.position.set(0, 3.5, 1.5); m.add(f); this.muzzles.push(f); }
    // one recoil pose per gun mount: arm guns + missile racks
    this.recoil = this.arms.map(() => new WeaponRecoil());
    this.missileRecoil = this.missileMuzzles.map(() => new WeaponRecoil(6, 0.9));
    // visible missile rack bodies (juggernaut pods), not just muzzle markers
    this.missilePods = [];
    m.traverse((o) => { if (o.name === 'missile_pod') this.missilePods.push(o); });
    if (!this.missilePods.length && this.missileMuzzles.length) {
      this.missilePods = this.missileMuzzles.map((mz) => mz.parent).filter((p): p is THREE.Object3D => !!p);
    }
    this.cannons = [];
    m.traverse((o) => { if (o.name === 'cannon') this.cannons.push(o); });
    m.rotation.order = 'YXZ';
    if (this.worldCfg && this.worldCfg.enabled !== false) {
      this.world = new WorldChunks(this.host.scene, (x, z) => this.host.groundHeight(x, z));
      this.world.setConfig(this.worldCfg, getAsset);
    }
    this.zoneDefs = this.worldCfg?.zones ?? [];
    this.zoneSpawned.clear();
    this.targets = this.host.getTargets().filter((t) => t.id !== this.ownId).map((t) => {
      const box = new THREE.Box3().setFromObject(t.group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const meshes: THREE.Mesh[] = [];
      t.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const maxHp = HP_BY_ASSET[t.assetId] ?? HP_BY_CAT[t.category] ?? 80;
      const solid = t.role !== 'spawn' && (box.max.y - this.host.groundHeight(center.x, center.z)) >= 1.1;
      return { ...t, box, center, hp: maxHp, maxHp, meshes, radius: Math.max(size.x, size.z) * 0.5, solid };
    });
    this.targetMeshes = this.targets.flatMap((t) => t.meshes);

    // --- точка появления по настройке игрока ---
    const spawnT = this.targets.find((t) => t.role === 'spawn');
    const place = (obj: THREE.Object3D) => {
      let p: THREE.Vector3 | null = null;
      if (this.cfg.spawnMode === 'spawn_object' && spawnT) p = spawnT.center.clone();
      else if (this.cfg.spawnMode === 'random' && this.worldCfg?.enabled !== false) {
        const sp = findSpawn(this.worldCfg!);
        p = new THREE.Vector3(sp.x, 0, sp.z);
      }
      if (p) obj.position.set(p.x, this.host.groundHeight(p.x, p.z), p.z);
      return p !== null;
    };
    place(m);
    this.pos.set(m.position.x, this.host.groundHeight(m.position.x, m.position.z), m.position.z);
    this.footOffset = m.position.y - this.pos.y;
    this.legYaw = m.rotation.y;
    this.camYaw = this.legYaw;
    this.camDist = this.view === 'tactical' ? this.cfg.tactical.distance : this.view === 'shoulder' ? this.cfg.shoulder.distance : this.cfg.third.distance;

    this.slots = this.cfg.weapons.slice(0, 4).map((id) => { const def = WEAPONS[id] || WEAPONS.none; return { def, ammo: def.ammo, cd: 0 }; });
    while (this.slots.length < 4) this.slots.push({ def: WEAPONS.none, ammo: null, cd: 0 });
    this.selected = Math.max(0, this.slots.findIndex((s) => s.def.kind !== 'none'));

    // scenario: player HP + live enemies from role=enemy objects
    this.pmax = Math.max(1, Math.round(this.scenario.playerHp));
    this.php = this.pmax;
    this.over = null; this.hurt = 0;
    for (const t of this.targets) {
      if (this.tuning) break;
      if (t.role !== 'enemy') continue;
      // люди и мехи становятся боевыми NPC, турели — стационарные
      const human = t.assetId === 'pilot_human' || t.assetId === 'survivor';
      const kind = (human ? 'infantry' : t.assetId === 'turret' ? 'turret' : t.assetId) as EnemyKindId;
      if (kind !== 'turret' && kind !== 'infantry' && kind !== 'mech_scout' && kind !== 'mech_juggernaut' && kind !== 'mech_molot') continue;
      const e = new Enemy(t.group, kind, t.id, {
        hpMul: this.scenario.enemyHpMul, dmgMul: this.scenario.enemyDmgMul,
        groundHeight: (x, z) => this.host.groundHeight(x, z),
        blocked: (x, z, r) => this.solidAt(x, z, r),
        fx: this.fx,
      });
      // патруль из сценария — общий для всех NPC
      const n = this.scenario.npc;
      if (n) {
        e.setPatrol({
          enabled: kind !== 'turret' && n.enabled,
          radius: n.patrolRadius, speedMul: n.patrolSpeed, waypoints: n.waypoints,
          pauseSec: n.pauseSec, aggro: n.aggro, alertSec: n.alertSec,
          leash: n.leash, returnHome: n.returnHome,
        });
      }
      t.enemy = e;
      t.hp = e.hp; t.maxHp = e.maxHp;
      this.enemies.push(e);
    }
    this.waveIdx = -1;
    this.waveT = this.scenario.waves.length ? this.scenario.waves[0].delaySec : 0;

    sfx.enabled = this.cfg.sfx;
    sfx.init();
    const d = this.host.dom;
    d.style.cursor = 'none';
    d.addEventListener('pointerdown', this.onPointerDown);
    d.addEventListener('mousedown', this.onMouseDown);
    d.addEventListener('auxclick', this.prevent);
    d.addEventListener('contextmenu', this.prevent);
    d.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    // Старт пешком: персонаж из сцены (или временный) появляется у меха
    if (this.cfg.playerStart === 'foot' && !this.tuning) {
      const atPilot = !!this.pilotObj;
      if (this.pilotObj) {
        this.bindScenePilot(this.pilotObj);
        this.footFromPilot = true;
      }
      this.eject();
      this.footFromPilot = false;
      this.pushLog(atPilot ? 'Старт пешком: ты там, где стоит пилот. Иди к меху и кликни по нему.' : 'Старт пешком: найди мех в сцене и кликни по нему, чтобы сесть.');
    } else {
      this.pushLog(`Пилот на связи. ${this.chassisInfo.name} готов. F — выйти из кабины, Esc — выход`);
    }
  }

  /** Взять под управление персонажа из сцены: учитываем его габариты и анимацию. */
  private bindScenePilot(group: THREE.Group): void {
    // временную фигурку прячем; объект сцены не удаляем
    if (this.pilot && this.pilot !== group) {
      this.pilot.visible = false;
      this.host.scene.remove(this.pilot);
      this.disposeTree(this.pilot);
    }
    this.pilot = group;
    // микшер привязан к группе — пересоздаём под нового аватара
    this.pilotMixer = null;
    this.pilotAction = null;
    this.pilotClipName = null;
    this.pilotIsFallback = false; // объект сцены (GLB со скелетом) анимируем микшером
    this.pilotLegs = [];
    this.pilotArms = [];
    for (const o of group.children) {
      if (o.name === 'leg_L' || o.name === 'leg_R') this.pilotLegs.push(o);
      else if (o.name === 'arm_L' || o.name === 'arm_R') this.pilotArms.push(o);
    }
    const box = new THREE.Box3().setFromObject(group);
    this.pilotFootDrop = box.min.y - group.position.y;
    group.visible = true;
  }

  /** Освободить геометрию/материалы визуального объекта. */
  private disposeTree(root: THREE.Object3D): void {
    // общая геометрия (из кэша батчей) не трогаем — её используют все инстансы вида
    const shared = !!root.userData.sharedGeo;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!shared) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // ОБЩИЕ материалы не трогаем: ими пользуется вся сцена, их удаление
      // заставит GPU перекомпилировать шейдеры (фриз на секунду)
      mats.forEach((x) => { if (!x.userData?.shared) x.dispose(); });
    });
  }

  /** id сценного персонажа, которым ходим (null — временный). */
  get pilotObjectId(): string | null { return this.pilotObjId; }

  /** Настройки анимаций пилота (скорости + ручные клипы из панели «Анимации»). */
  setPilotAnim(s: { walk?: number; run?: number; jump?: number; idle?: number; global?: number; clipMap?: Partial<Record<string, string>> }): void {
    this.pilotSpeeds = { walk: s.walk ?? 1, run: s.run ?? 1, jump: s.jump ?? 1, idle: s.idle ?? 1, global: s.global ?? 1 };
    this.pilotClipMap = s.clipMap ?? null;
  }

  dispose() {
    this.collisionDebug?.dispose(); this.collisionDebug = null;
    const d = this.host.dom;
    d.style.cursor = '';
    d.removeEventListener('pointerdown', this.onPointerDown);
    d.removeEventListener('mousedown', this.onMouseDown);
    d.removeEventListener('auxclick', this.prevent);
    d.removeEventListener('contextmenu', this.prevent);
    d.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.projectiles.forEach((p) => this.fx.remove(p.mesh));
    this.projectiles = [];
    this.eproj.forEach((p) => this.fx.remove(p.mesh));
    this.eproj = [];
    for (const t of this.targets) {
      if (!t.transient) continue;
      this.host.scene.remove(t.group);
      t.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((x) => { if (x) x.dispose(); });
          if (m.geometry) m.geometry.dispose();
        }
      });
    }
    this.enemies = [];
    this.loose = [];
    this.recoil = [];
    this.missileRecoil = [];
    // объект сцены не трогаем: его вернёт редактор, ресурсы освободит сам
    if (this.pilot) {
      if (this.pilot !== this.pilotObj) { this.host.scene.remove(this.pilot); this.disposeTree(this.pilot); }
      this.pilot = null;
    }
    if (this.marker) { this.host.scene.remove(this.marker); this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose(); this.marker = null; }
    this.pilotLegs = [];
    this.pilotArms = [];
    this.worldProps.clear();
    this.ejected = false;
    this.fx.dispose();
    this.world?.dispose();
    this.world = null;
  }

  // ======================= input =======================
  private prevent = (e: Event) => e.preventDefault();
  private onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
  private onBlur = () => { this.keys.clear(); this.lmb = this.rmb = this.mmb = false; };
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.tuning) { if (e.code === 'Escape') this.cb.onExit(); return; }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Escape': this.cb.onExit(); break;
      // V/N/C — механика меха: пешком не нужны (кабина на пилоте ломает камеру)
      case 'KeyV': if (!this.ejected) this.setView(VIEW_ORDER[(VIEW_ORDER.indexOf(this.view) + 1) % VIEW_ORDER.length]); break;
      case 'KeyN': if (!this.ejected) this.setVision(VISION_ORDER[(VISION_ORDER.indexOf(this.vision) + 1) % VISION_ORDER.length]); break;
      case 'KeyC': if (!this.ejected) { this.lookYaw = 0; this.lookPitch = 0; this.camYaw = this.legYaw; } break;
      // H — аптечка (в HUD так и написано). Справка открывается клавишей F1.
      case 'KeyH': this.useMedkit(); break;
      case 'KeyF':
        if (this.ejected) this.reenterOwnMech();
        else this.eject();
        break;
      case 'F1': this.showHelp = !this.showHelp; break;
      case 'Tab': this.selectNext(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.select(parseInt(e.code[5], 10) - 1); break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onPointerDown = (e: PointerEvent) => {
    if (this.tuning) return;
    if (this.ejected && e.button === 0) {
      // Клик вне кабины: ищем ближайший мех по объёму (бросок луча в боксы).
      // Так попасть легко — не нужно целиться точно в геометрию.
      const rect = this.host.dom.getBoundingClientRect();
      this.raycaster.setFromCamera(
        new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
        this.host.camera,
      );
      let best: { group: THREE.Group; id: string | null; assetId: string; d: number; dist: number } | null = null;
      let nearest: { group: THREE.Group; id: string | null; assetId: string; dist: number } | null = null;
      const candidates = this.host.getTargets()
        .filter((t) => t.assetId.startsWith('mech_'))
        .map((t) => ({ group: t.group, id: t.id as string | null, assetId: t.assetId }));
      // созданный нами мех в списке объектов сцены отсутствует — добавляем вручную
      if (this.lastMech) candidates.push({ ...this.lastMech });
      for (const c of candidates) {
        const box = new THREE.Box3().setFromObject(c.group);
        if (box.isEmpty()) continue;
        const center = box.getCenter(new THREE.Vector3());
        // расстояние от пилота до меха — можно садиться только рядом
        const dist = Math.hypot(center.x - this.pos.x, center.z - this.pos.z);
        if (!nearest || dist < nearest.dist) nearest = { ...c, dist };
        box.expandByScalar(1.2);
        const at = new THREE.Vector3();
        const point = this.raycaster.ray.intersectBox(box, at);
        if (!point) continue;
        const d = point.distanceTo(this.raycaster.ray.origin);
        if (!best || d < best.d) best = { ...c, d, dist };
      }
      // порог: почти у борта (2.5 м) — сразу вкарабкивание, дальше — подбегание
      const climbNear = 2.5;
      // 1) кликнул по меху — рядом вкарабкиваемся, дальше идём сами
      if (best) {
        if (best.dist <= climbNear) { this.startClimb(best.id ?? undefined, best.group, best.assetId); return; }
        if (best.dist <= 45) {
          this.seatApproach = { id: best.id ?? '__created__', group: best.group, assetId: best.assetId };
          this.pushLog(`Мех в ${Math.round(best.dist)} м: пилот сам дойдёт. WASD — отмена.`);
          return;
        }
        this.pushLog(`Слишком далеко (${Math.round(best.dist)} м). Подойди на 45 м и кликни снова.`);
        return;
      }
      // 2) промахнулся, но рядом есть мех — ближайший подходит сам (не нужно целиться)
      if (nearest && nearest.dist <= climbNear) { this.startClimb(nearest.id ?? undefined, nearest.group, nearest.assetId); return; }
      if (nearest && nearest.dist <= 45) {
        this.seatApproach = { id: nearest.id ?? '__created__', group: nearest.group, assetId: nearest.assetId };
        this.pushLog(`Ближайший мех в ${Math.round(nearest.dist)} м: пилот сам дойдёт. WASD — отмена.`);
        return;
      }
      if (nearest) {
        this.pushLog(`Ближайший мех в ${Math.round(nearest.dist)} м — это слишком далеко, подойди на 45 м.`);
        return;
      }
      this.pushLog('Мимо: наведи курсор на мех и кликни.');
      return;
    }
    if (e.button === 1) { this.mmb = true; e.preventDefault(); }
    if (e.button === 0) this.lmb = true;
    if (e.button === 2) this.rmb = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    sfx.init();
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 1) this.mmb = false;
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (this.tuning) return;
    const r = this.host.dom.getBoundingClientRect();
    // во время автоподхода к меху камера сама доворачивается — мышь не дёргает её
    if (this.seatApproach) { this.cb.onPointer(e.clientX - r.left, e.clientY - r.top, true); return; }
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const dx = e.clientX - this.lastMouse.x, dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    const freeLook = this.mmb || !this.cfg.cameraNeedsMMB;
    if (freeLook) {
      const s = 0.0035 * this.cfg.sensitivity; const iy = this.cfg.invertY ? -1 : 1;
      if (this.view === 'cockpit') {
        this.lookYaw -= dx * s;
        const lim = THREE.MathUtils.degToRad(this.cfg.cockpit.pitchLimit);
        this.lookPitch = clamp(this.lookPitch - dy * s * iy, -lim, lim);
      } else {
        this.camYaw -= dx * s;
        this.camPitch = clamp(this.camPitch + dy * s * iy, 0.06, 1.45);
      }
    }
    this.cb.onPointer(e.clientX - r.left, e.clientY - r.top, true);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const d = Math.sign(e.deltaY);
    const previous = this.view === 'cockpit' ? this.fovZoom : this.camDist;
    if (this.view === 'cockpit') this.fovZoom = clamp(this.fovZoom + d * 0.08, 0.45, 1.15);
    else this.camDist = clamp(this.camDist * (1 + d * 0.1), 3, 50);
    if (previous !== (this.view === 'cockpit' ? this.fovZoom : this.camDist)) sfx.zoom(d, this.pos);
  };

  // ======================= public API =======================
  setView(v: ViewMode) {
    if (v === this.view) return;
    // пешком — только вид снаружи: режимы меха (кабина/тактика/плечо) недоступны
    if (this.ejected) {
      if (v !== 'third') { this.pushLog('Пешком пользуются только видом снаружи.'); return; }
    }
    if (v === 'cockpit') { this.lookYaw = this.torsoOffset; this.lookPitch = 0; }
    else if (this.view === 'cockpit') this.camYaw = this.legYaw + this.torsoOffset;
    this.view = v;
    this.camDist = v === 'tactical' ? this.cfg.tactical.distance : v === 'shoulder' ? this.cfg.shoulder.distance : this.cfg.third.distance;
    if (v === 'tactical') this.camPitch = THREE.MathUtils.degToRad(this.cfg.tactical.pitch);
    else if (v !== 'cockpit') this.camPitch = 0.42;
    sfx.select(this.pos);
  }
  setVision(v: VisionMode) { this.vision = v; sfx.select(this.pos); }

  /** Пилот вне меха: WASD — ходьба, мышь — обзор, кольцо подсвечивает мех для посадки. */
  private updateFreeCamera(dt: number) {
    // вкарабкивание: ввод блокируем, управляющее — клип
    if (this.pendingSeat) { this.updateClimb(dt); return; }
    const k = this.keys;
    const sprintKey = k.has('ShiftLeft') || k.has('ShiftRight');
    // без выносливости бег невозможен — при нуле только шаг
    const canRun = this.stamina > 1;
    const sprint = sprintKey && canRun;
    let maxSpeed = sprint ? this.cfg.foot.run : this.cfg.foot.walk;
    maxSpeed *= sprint ? this.balance.pilotRun : this.balance.pilotWalk;
    this.runningNow = sprint;
    // автоподход к меху: играем бегом/шагом до кабины — отменяется любым шагом
    if (this.seatApproach && (k.has('KeyW') || k.has('KeyS') || k.has('KeyA') || k.has('KeyD'))) {
      this.seatApproach = null;
      this.pushLog('Подход отменён — ты на ручном управлении.');
    }
    // «вперёд» в проекте = (sin yaw, cos yaw) — как у меха в moveDistance
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    let wish = new THREE.Vector3();
    if (k.has('KeyW')) wish.add(fwd);
    if (k.has('KeyS')) wish.sub(fwd);
    if (k.has('KeyA')) wish.sub(right);
    if (k.has('KeyD')) wish.add(right);
    if (this.seatApproach) {
      const t = this.seatApproach;
      const box = new THREE.Box3().setFromObject(t.group);
      if (box.isEmpty() || !this.host.getTargets().some((x) => x.group === t.group)) {
        this.seatApproach = null; // мех пропал/разобран по пути
      } else {
        const c = box.getCenter(new THREE.Vector3());
        const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        const arrive = Math.max(1.8, box.getSize(new THREE.Vector3()).length() * 0.3);
        if (dist <= arrive) {
          this.seatApproach = null;
          this.pilotVel.set(0, 0, 0);
          this.startClimb(t.id, t.group, t.assetId); // подошёл — вкарабкивается
        } else {
          // далеко - бежим (если есть выносливость), ближе — шагаем
          const far = dist > 6 && canRun;
          this.runningNow = far;
          maxSpeed = far ? this.cfg.foot.run : this.cfg.foot.walk;
          wish.set(dx / dist, 0, dz / dist).multiplyScalar(maxSpeed);
          // камера мягко доворачивается на мех, чтобы пилот шёл к нему лицом
          const ty = Math.atan2(dx, dz);
          let dyaw = ((ty - this.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          this.camYaw += dyaw * Math.min(1, dt * 8);
        }
      }
    }
    const running = wish.lengthSq() > 0;
    if (running) wish.normalize().multiplyScalar(maxSpeed);
    // плавный разгон/торможение по вектору скорости
    const a = 1 - Math.exp(-(running ? 12 : 16) * dt);
    this.pilotVel.lerp(wish, a);
    this.pos.x += this.pilotVel.x * dt;
    this.pos.z += this.pilotVel.z * dt;
    this.boundXZ(this.pos);
    const gy = this.host.groundHeight(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
    const spd = this.pilotVel.length();
    this.speed = spd;
    this.moveRatio = Math.min(1, spd / maxSpeed);

    // анимация шага/бега пилота: настоящие клипы из Pilot_Anim.glb через AnimationMixer
    if (this.pilot) {
      // GLB догрузился после выхода — подменяем процедурный силуэт на модель
      if (this.pilotIsFallback && getPilotModel()) {
        this.host.scene.remove(this.pilot);
        this.pilotMixer = null;
        this.pilotAction = null;
        this.pilotClipName = null;
        this.pilotLegs = [];
        this.pilotArms = [];
        this.pilot = this.buildPilot();
        this.host.scene.add(this.pilot);
      }
      // pos — точка на земле, а модель начинается выше: опускаем до уровня стоп
      this.pilot.position.set(this.pos.x, this.pos.y - this.pilotFootDrop, this.pos.z);
      // разворачиваемся по направлению движения (S — разворот лицом назад),
      // а в покое смотрим туда же, куда камера
      const moveLen = this.pilotVel.length();
      if (moveLen > 0.3) {
        const moveYaw = Math.atan2(this.pilotVel.x, this.pilotVel.z);
        let dyaw = ((moveYaw - this.pilot.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.pilot.rotation.y += dyaw * Math.min(1, dt * 10);
      } else {
        this.pilot.rotation.y = this.camYaw;
      }
      if (!this.pilotMixer) {
        this.pilotMixer = new THREE.AnimationMixer(this.pilot);
      }
      if (this.pilotMixer && getPilotAnimationClips().length > 0) {
        const clips = getPilotAnimationClips();
        const maxSpd = Math.max(0.5, this.cfg.foot.run);
        const ratio = Math.min(1, spd / maxSpd);
        let stateName: 'walk' | 'run' | 'idle' | null = null;
        let timeScale = 0;
        if (ratio > 0.55) {
          stateName = 'run';
          timeScale = 0.9 + ratio * 0.4;
        } else if (ratio > 0.02) {
          stateName = 'walk';
          timeScale = 0.8 + ratio * 0.7;
        }
        let clipName: string | null = null;
        if (stateName) {
          // ручное назначение из панели «Анимации» главнее, потом — по смыслу
          clipName = this.pilotClipMap?.[stateName]
            ?? (stateName === 'run' ? 'Run_Anime' : 'Walk');
          // множитель скорости состояния × общий
          timeScale *= (stateName === 'run' ? this.pilotSpeeds.run : this.pilotSpeeds.walk) * (this.pilotSpeeds.global || 1);
        } else {
          // покой: Idle_A (или ручной клип) вместо застывшей позы
          const idleOver = this.pilotClipMap?.idle;
          const idleAuto = clips.some((c) => c.name === 'Idle_A' || c.name === 'Idle' || c.name === 'idle')
            ? (clips.find((c) => c.name === 'Idle_A')?.name ?? clips.find((c) => c.name === 'Idle')?.name ?? 'idle')
            : null;
          if (idleOver || idleAuto) {
            stateName = 'idle';
            clipName = idleOver ?? idleAuto;
            const idleMul = (this.pilotSpeeds.idle || 1) * (this.pilotSpeeds.global || 1);
            timeScale = idleMul > 0.001 ? idleMul : 1;
          }
        }
        if (clipName) {
          if (clipName !== this.pilotClipName) {
            this.pilotMixer.stopAllAction();
            const clip = clips.find((c) => c.name === clipName);
            if (clip) {
              // фильтруем треки: оставляем только те, чьи кости есть в модели —
              // иначе THREE.PropertyBinding спамит «No target node found» и ломает рендер
              const mesh = this.pilot;
              const safe = clip.clone();
              safe.tracks = clip.tracks.filter((tr) => {
                const prop = tr.name.split('.')[0];
                return !!mesh.getObjectByName(prop);
              });
              if (safe.tracks.length) {
                this.pilotAction = this.pilotMixer.clipAction(safe);
                this.pilotClipName = clipName;
                this.pilotAction.reset();
                this.pilotAction.setLoop(THREE.LoopRepeat, Infinity);
                this.pilotAction.setEffectiveTimeScale(timeScale);
                this.pilotAction.play();
              } else {
                this.pilotClipName = null;
              }
            }
          } else {
            this.pilotAction?.setEffectiveTimeScale(timeScale);
          }
        } else {
          this.pilotMixer.stopAllAction();
          this.pilotAction = null;
          this.pilotClipName = null;
        }
      } else if (this.pilotIsFallback) {
        // запасной силуэт: качаем суставы
        const swing = Math.sin(this.legPhase) * 0.85 * this.moveRatio;
        this.pilotLegs[0].rotation.x = swing;
        this.pilotLegs[1].rotation.x = -swing;
        this.pilotArms[0].rotation.x = -swing * 0.75;
        this.pilotArms[1].rotation.x = swing * 0.75;
        this.pilotArms[0].rotation.z = 0.12;
        this.pilotArms[1].rotation.z = -0.12;
        this.legPhase += spd * dt * 2.6;
        this.pilot.position.y += Math.abs(Math.sin(this.legPhase)) * 0.045 * this.moveRatio;
      }
      if (this.pilotMixer && !this.pilotIsFallback) this.pilotMixer.update(dt);
    }

    // кольцо-подсказка под ближайшим доступным мехом
    this.markerT += dt;
    if (this.marker) {
      const near = this.nearestSeatMech();
      if (near) {
        const p = near.box.getCenter(new THREE.Vector3());
        this.marker.visible = true;
        this.marker.position.set(p.x, this.host.groundHeight(p.x, p.z) + 0.06, p.z);
        const s = 1 + Math.sin(this.markerT * 3) * 0.06;
        this.marker.scale.setScalar(s);
      } else this.marker.visible = false;
    }

    this.camDist = clamp(this.camDist, 3, 40);
    this.camInit = false; // камера следует за пилотом без задержки
    this.updateCamera(dt);
    this.hudT += dt;
    if (this.hudT > 1 / 12) { this.hudT = 0; this.cb.onHud(this.buildHud()); }
  }

  /** Ближайший мех, в который можно сесть (центр и радиус). */
  private nearestSeatMech(): { group: THREE.Group; box: THREE.Box3 } | null {
    let best: { group: THREE.Group; box: THREE.Box3 } | null = null;
    let bestD = 26 * 26;
    const consider = (group: THREE.Group) => {
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      const d = (c.x - this.pos.x) ** 2 + (c.z - this.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = { group, box }; }
    };
    for (const t of this.host.getTargets()) {
      if (!t.assetId.startsWith('mech_')) continue;
      consider(t.group);
    }
    if (this.lastMech) consider(this.lastMech.group);
    return best;
  }

  /** Пересобрать ссылки на части корпуса (после смены меха) */
  private bindMechParts(m: THREE.Group) {
    this.torso = null;
    this.legs.length = 0;
    this.arms.length = 0;
    this.muzzles.length = 0;
    this.missileMuzzles.length = 0;
    m.traverse((o) => {
      if (o.name === 'torso') this.torso = o;
      else if (o.name === 'leg_L') this.legs[0] = o;
      else if (o.name === 'leg_R') this.legs[1] = o;
      else if (o.name === 'arm_L' || o.name === 'arm_R') this.arms.push(o);
      else if (o.name === 'muzzle') this.muzzles.push(o);
      else if (o.name === 'muzzle_missile') this.missileMuzzles.push(o);
    });
    if (!this.muzzles.length) { const f = new THREE.Object3D(); f.position.set(0, 3.5, 1.5); m.add(f); this.muzzles.push(f); }
    this.recoil = this.arms.map(() => new WeaponRecoil());
    this.missileRecoil = this.missileMuzzles.map(() => new WeaponRecoil(6, 0.9));
    this.missilePods = [];
    m.traverse((o) => { if (o.name === 'missile_pod') this.missilePods.push(o); });
    if (!this.missilePods.length && this.missileMuzzles.length) {
      this.missilePods = this.missileMuzzles.map((mz) => mz.parent).filter((p): p is THREE.Object3D => !!p);
    }
    this.cannons = [];
    m.traverse((o) => { if (o.name === 'cannon') this.cannons.push(o); });
    m.rotation.order = 'YXZ';
  }

  /** Лут из уничтоженного объекта. Для врагов — разбор машины (если включён в сценарии). */
  private grantLoot(t: Target): void {
    const L = this.scenario.lootSettings;
    const isEnemy = !!t.enemy;
    if (isEnemy && !L.salvage) return;
    if (!isEnemy && !L.enabled) return;
    const multiplier = isEnemy ? L.salvageMul : 1 + L.rarityBoost;
    const drops = rollLoot(t.assetId, {
      tables: this.scenario.loot,
      multiplier,
      salvageOnly: isEnemy,
    });
    if (!drops.length) return;
    const dist = t.center.distanceTo(this.pos);
    const near = L.autoPickup && dist < 6;
    const taken: ItemId[] = [];
    const left: ItemId[] = [];
    for (const id of drops) {
      if (near) {
        const got = this.inventory.add(id, 1);
        if (got) taken.push(id); else left.push(id);
      } else left.push(id);
    }
    if (taken.length) {
      const names = uniqCount(taken).map(([id, n]) => `${ITEMS[id].short}×${n}`).join(', ');
      this.pushLog(`${isEnemy ? 'Разобрано: ' : 'Подобрано: '}${names}`);
      if (L.autoPickup) sfx.select(this.pos);
    }
    if (left.length) this.pushLog(`Осталось на земле: ${uniqCount(left).map(([id, n]) => `${ITEMS[id].short}×${n}`).join(', ')}`);
  }

  /** Список рецептов из сценария с состоянием «хватает деталей». */
  craftOptions(): { id: string; name: string; desc: string; ok: boolean; missing: string }[] {
    return (this.scenario.craft ?? []).map((r) => {
      const missing = r.parts
        .filter((p) => this.inventory.count(p.item) < p.count)
        .map((p) => `${ITEMS[p.item].short}×${p.count - this.inventory.count(p.item)}`);
      return { id: r.id, name: r.name, desc: r.desc, ok: canCraft(this.inventory, r), missing: missing.join(', ') };
    });
  }

  /** Собрать мех: списывает детали и ставит готовый корпус рядом с игроком. */
  craftMech(recipeId: string): boolean {
    const recipe = (this.scenario.craft ?? []).find((r) => r.id === recipeId);
    if (!recipe) return false;
    const chassis = craft(this.inventory, recipe);
    if (!chassis) { this.pushLog('Не хватает деталей для сборки.'); return false; }
    const a = this.camYaw + Math.PI;
    const at = new THREE.Vector3(this.pos.x + Math.sin(a) * 7, 0, this.pos.z + Math.cos(a) * 7);
    this.boundXZ(at);
    const x = at.x, z = at.z;
    const group = this.host.spawnEnemy(chassis, x, z);
    if (!group) { this.pushLog('Не удалось поставить корпус.'); return false; }
    this.pushLog(`Собран ${CHASSIS[chassis]?.name ?? chassis}. Подойди и сядь — ЛКМ по корпусу.`);
    return true;
  }

  /** Использовать аптечку (клавиша H в превью, когда пешком). */
  useMedkit(): boolean {
    if (!this.inventory.take('medkit', 1)) return false;
    this.php = Math.min(this.pmax, this.php + 40);
    this.pushLog('Аптечка: +40 здоровья.');
    return true;
  }

  // ======================= стройка базы =======================
  /** Рецепты построек: название → цена в ресурсах инвентаря. */
  private static BUILD_RECIPES: Record<string, Partial<Record<ItemId, number>>> = {
    barrier: { scrap: 4 },
    bunker_wall: { plate: 3, scrap: 2 },
    sandbags: { scrap: 2 },
    generator: { plate: 2, gear: 1, fuel_cell: 1 },
    barrel: { scrap: 1 },
  };

  /** Список доступных построек с ценами (для панели «Стройка»). */
  buildOptions(): { kind: string; name: string; cost: string; ok: boolean }[] {
    const out: { kind: string; name: string; cost: string; ok: boolean }[] = [];
    for (const [kind, cost] of Object.entries(PlayController.BUILD_RECIPES)) {
      const def = getAsset(kind);
      if (!def) continue;
      const costStr = Object.entries(cost)
        .map(([id, n]) => `${ITEMS[id as ItemId].short}×${n}`)
        .join(', ');
      const ok = Object.entries(cost).every(([id, n]) => this.inventory.count(id as ItemId) >= (n ?? 0));
      out.push({ kind, name: def.name, cost: costStr, ok });
    }
    return out;
  }

  /** Построить объект перед мехом, списав ресурсы. */
  buildStructure(kind: string): boolean {
    const cost = PlayController.BUILD_RECIPES[kind];
    if (!cost) return false;
    for (const [id, n] of Object.entries(cost)) {
      if (this.inventory.count(id as ItemId) < (n ?? 0)) {
        this.pushLog('Не хватает ресурсов на стройку.');
        return false;
      }
    }
    const def = getAsset(kind);
    if (!def) return false;
    const group = def.build();
    this.host.scene.add(group);
    // ставим перед мехом
    const a = this.camYaw + Math.PI;
    const d = 6;
    const at = new THREE.Vector3(this.pos.x + Math.sin(a) * d, 0, this.pos.z + Math.cos(a) * d);
    this.boundXZ(at);
    const gy = this.host.groundHeight(at.x, at.z);
    const box = new THREE.Box3().setFromObject(group);
    group.position.set(at.x, gy - box.min.y, at.z);
    group.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(group);
    const center = box2.getCenter(new THREE.Vector3());
    const size = box2.getSize(new THREE.Vector3());
    const meshes: THREE.Mesh[] = [];
    const id = 'built_' + Date.now() + '_' + kind;
    group.traverse((o) => {
      o.userData.objectId = id;
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const hp = Math.max(30, Math.round(size.x * size.y * size.z * 4));
    const target: Target = {
      id, group, assetId: kind, name: def.name, category: def.category, role: 'prop',
      box: box2, center, meshes, hp, maxHp: hp,
      radius: Math.max(size.x, size.z) * 0.5, solid: true, transient: false,
    };
    this.targets.push(target);
    this.targetMeshes.push(...meshes);
    // списываем ресурсы
    for (const [id2, n] of Object.entries(cost)) {
      this.inventory.take(id2 as ItemId, n ?? 0);
    }
    this.pushLog(`Построено: ${def.name}.`);
    sfx.select(this.pos);
    this.cb.onHud(this.buildHud());
    return true;
  }

  /** Выносливость: тратится на бег, восстанавливается. */
  private updateStamina(dt: number): void {
    const v = this.cfg.vitals;
    const running = this.ejected && this.runningNow && this.pilotVel.length() > this.cfg.foot.walk * 0.6;
    if (running) this.stamina = Math.max(0, this.stamina - v.runDrain * dt);
    else this.stamina = Math.min(v.stamina, this.stamina + v.staminaRegen * dt);
  }

  /** Покинуть мех: пилот выходит на землю. Превью продолжается. */
  eject(): boolean {
    if (this.ejected || this.tuning) return false;
    this.lastMech = { group: this.mech, id: this.ownId, assetId: this.chassisAsset };
    this.ejected = true;
    this.mech.visible = true;
    this.speed = 0;
    this.airborne = false;
    this.shake = 0; // тряска камеры — механика меха, пешком камера спокойна
    this.moveState = { ...this.moveState, speed: 0, vy: 0, jumping: false, airborne: false };

    // появляется пилот рядом с кабиной
    const box = new THREE.Box3().setFromObject(this.mech);
    const exit = box.max.clone();
    exit.x -= Math.sign(exit.x || 1) * (box.max.x - box.min.x) * 0.5 - 1.2;
    if (this.footFromPilot && this.pilotObj) {
      // старт «Пешком»: играем от места, где стоит поставленный пилот, без переносов
      const g = this.pilotObj.position;
      this.pos.set(g.x, this.host.groundHeight(g.x, g.z), g.z);
    } else {
      const gy = this.host.groundHeight(exit.x, exit.z);
      this.pos.set(exit.x, gy, exit.z + 1.6);
    }
    if (this.pilotObj && this.pilot !== this.pilotObj) {
      // сценный пилот идёт под управление — никакой второй (временной) фигурки
      this.bindScenePilot(this.pilotObj);
    } else if (!this.pilot) {
      this.pilot = this.buildPilot();
      this.host.scene.add(this.pilot);
    }
    const pilot = this.pilot;
    if (!pilot) return false;
    pilot.visible = true;
    pilot.position.set(this.pos.x, this.pos.y - this.pilotFootDrop, this.pos.z);
    pilot.rotation.y = this.camYaw;
    this.pilotLegs.forEach((l) => { l.rotation.x = 0; });
    this.pilotArms.forEach((a) => { a.rotation.set(0, 0, a === this.pilotArms[0] ? 0.12 : -0.12); });
    if (!this.marker) {
      this.marker = this.buildMarker();
      this.host.scene.add(this.marker);
    }

    // вид «снаружи» вместо кабины + плавный переезд камеры
    const prevView = this.view;
    this.view = 'third';
    this.camYaw = this.legYaw;
    this.camPitch = 0.28;
    this.camDist = 7;
    this.camInit = false;
    this.fovZoom = 1;
    this.host.dom.style.cursor = 'crosshair';
    this.pushLog(`Пилот вышел из кабины (${prevView === 'cockpit' ? 'вид из кабины' : 'вид снаружи'}). WASD — идти, ЛКМ по меху — сесть, F — вернуться.`);
    sfx.select(this.pos);
    this.cb.onHud(this.buildHud());
    return true;
  }

  /** Общий вход: принять группу меха (созданный или объект сцены). */
  private seatIn(group: THREE.Group, objectId: string | null, assetId: string): boolean {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());
    this.mech = group;
    this.ownId = objectId;
    this.chassisAsset = assetId;
    this.chassisInfo = CHASSIS[assetId] || CHASSIS.mech_scout;
    // у импортированных мехов (mech_custom_*) нет записи в CHASSIS:
    // считаем точку кабины/радиус прямо из модели
    if (!CHASSIS[assetId]) {
      const b = new THREE.Box3().setFromObject(group);
      const sz = b.getSize(new THREE.Vector3());
      const cx = b.getCenter(new THREE.Vector3());
      const invRadius = Math.max(0.8, Math.max(sz.x, sz.z) * 0.5);
      this.chassisInfo = {
        name: this.chassisInfo.name,
        cockpit: [
          (cx.x - b.min.x) * 0.5,
          Math.max(0.3, sz.y * 0.45),
          Math.max(0.6, sz.z * 0.35),
        ] as [number, number, number],
        radius: invRadius,
        tonnage: Math.round(sz.x * sz.y * sz.z * 0.35),
        speedMul: 0.9,
        turnMul: 0.95,
      };
    }
    this.bindMechParts(group);
    this.ejected = false;
    if (this.pilot) this.pilot.visible = false;
    if (this.pilotMixer) {
      this.pilotMixer.stopAllAction();
      this.pilotAction = null;
      this.pilotClipName = null;
    }
    if (this.marker) this.marker.visible = false;
    this.pos.set(center.x, this.host.groundHeight(center.x, center.z), center.z);
    this.footOffset = 0;
    this.legYaw = group.rotation.y;
    this.torsoOffset = 0;
    this.moveState = {
      speed: 0, vy: 0, y: this.pos.y, yaw: this.legYaw, airborne: false,
      jetFuel: this.moveState.jetFuel, heat: 0, landing: 0, jumping: false,
    };
    this.speed = 0;
    this.moveRatio = 0;
    this.camDist = this.cfg.third.distance;
    this.camYaw = this.legYaw;
    this.camPitch = 0.42;
    this.host.dom.style.cursor = 'none';
    this.pushLog(`Пилот в кабине: ${this.chassisInfo.name}.`);
    sfx.select(this.pos);
    this.cb.onHud(this.buildHud());
    return true;
  }

  /** Сесть в мех по id объекта сцены. */
  enterMech(objectId: string): boolean {
    const obj = this.host.getTargets().find((t) => t.id === objectId);
    if (!obj || !obj.assetId.startsWith('mech_')) { this.pushLog('Это не мех — сесть нельзя.'); return false; }
    if (!this.ejected && this.ownId === objectId) return false;
    if (this.mech === obj.group && !this.ejected) return false;
    // почти у борта — сразу вкарабкивание, дальше — пилот сам подбежит
    const climbNear = 2.5;
    const box = new THREE.Box3().setFromObject(obj.group);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      const dist = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (dist > 45) {
        this.pushLog(`Мех в ${Math.round(dist)} м — это слишком далеко, подойди на 45 м.`);
        return false;
      }
      if (dist > climbNear) {
        this.seatApproach = { id: obj.id, group: obj.group, assetId: obj.assetId };
        this.pushLog(`Мех в ${Math.round(dist)} м: пилот сам дойдёт. WASD — отмена.`);
        return true;
      }
    }
    if (this.ejected) {
      // вкарабкивание: играет клип (Climb_Wall / назначенный вручную), потом садимся
      this.startClimb(obj.id, obj.group, obj.assetId);
      return true;
    }
    return this.seatIn(obj.group, obj.id, obj.assetId);
  }

  /** Вернуться в тот мех, из которого вышли (F). Работает и для созданного меха. */
  reenterOwnMech(): boolean {
    if (!this.ejected) return false;
    // почти у борта — сразу вкарабкивание, дальше — пилот сам подбежит
    const climbNear = 2.5;
    const target = this.lastMech ?? (this.ownId ? { group: this.mech, id: this.ownId, assetId: this.chassisAsset } : null);
    if (target) {
      const box = new THREE.Box3().setFromObject(target.group);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        const dist = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
        if (dist > 45) {
          this.pushLog(`Мех в ${Math.round(dist)} м — это слишком далеко, подойди на 45 м.`);
          return false;
        }
        if (dist > climbNear) {
          this.seatApproach = { id: (target as { group: THREE.Group; id: string | null; assetId: string }).id ?? '__created__', group: target.group, assetId: target.assetId };
          this.pushLog(`Мех в ${Math.round(dist)} м: пилот сам дойдёт. WASD — отмена.`);
          return true;
        }
      }
    }
    if (this.lastMech) {
      this.startClimb(this.lastMech.id ?? undefined, this.lastMech.group, this.lastMech.assetId);
      return true;
    }
    if (this.ownId) return this.enterMech(this.ownId);
    return false;
  }

  /** id объекта меха, в котором игрок СЕЙЧАС сидит (null — игрок пешком). */
  get currentMechId(): string | null {
    return this.ejected ? null : this.ownId;
  }

  // ======================= ПРОЧНОСТЬ МЕХА =======================
  /** Ближайший мех и расстояние до него (для подсказки «подойди ближе»). */
  private nearestMechInfo(): { name: string; dist: number } | null {
    let best: { name: string; dist: number } | null = null;
    const list = this.host.getTargets().filter((t) => t.assetId.startsWith('mech_'));
    for (const t of list) {
      const box = new THREE.Box3().setFromObject(t.group);
      if (box.isEmpty()) continue;
      const c = box.getCenter(new THREE.Vector3());
      const dist = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (!best || dist < best.dist) best = { name: t.name, dist };
    }
    if (!best && this.lastMech) {
      const box = new THREE.Box3().setFromObject(this.lastMech.group);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        best = { name: 'свой мех', dist: Math.hypot(c.x - this.pos.x, c.z - this.pos.z) };
      }
    }
    return best;
  }

  /** Прочность меха: из тоннажа шасси. У каждого меха своя (резервный может быть побитый). */
  private mechHpMap = new Map<string, number>();

  mechMaxHp(): number {
    return Math.max(50, Math.round((this.chassisInfo.tonnage || 40) * 14));
  }

  mechHp(): number {
    const id = this.ownId;
    if (!id) return 0;
    const full = this.mechMaxHp();
    return this.mechHpMap.get(id) ?? full;
  }

  /**
   * Попадание по меху: броня меха ест урон, пилоту проходит лишь кровь сквозь броню.
   * Броня кончилась — мех взрывается, пилота выбрасывает и он получает остаток урона.
   */
  private damageMech(amount: number): void {
    if (this.over || this.ejected) { this.damagePlayer(amount); return; }
    const id = this.ownId;
    if (!id) { this.damagePlayer(amount); return; }
    const full = this.mechMaxHp();
    const hp = Math.max(0, (this.mechHpMap.get(id) ?? full) - amount * this.balance.dmgToPlayer);
    this.mechHpMap.set(id, hp);
    this.hurt = 1;
    this.shake += 0.12;
    sfx.playerHurt(this.pos);
    // 25% урона проходит по пилоту, пока мех цел
    this.php -= amount * 0.25;
    if (this.php <= 0) {
      this.php = 0;
      this.over = 'lost';
      sfx.lose(this.pos);
      this.pushLog('Пилот погиб. Esc - выход в редактор.');
      return;
    }
    if (hp <= 0) {
      // мех уничтожен: взрыв, пилота выбрасывает
      const c = this.mech.position.clone();
      this.fx.explosion(c, 2.4, { debrisMat: getSharedMaterials().mechArmor, debris: 14 });
      sfx.explosion(1.4, c);
      this.shake += 0.6;
      this.mechHpMap.delete(id);
      this.pushLog('Мех уничтожен — пилот выброшен!');
      this.eject();
      this.damagePlayer(Math.round(amount * 0.75));
    }
  }

  select(i: number) { if (this.slots[i] && this.slots[i].def.kind !== 'none') { this.selected = i; sfx.select(this.pos); } }
  selectNext() { for (let k = 1; k <= 4; k++) { const i = (this.selected + k) % 4; if (this.slots[i].def.kind !== 'none') { this.selected = i; sfx.select(this.pos); return; } } }

  /** Убрать «ожившие» пропы, которые остались далеко — иначе сцена растёт бесконечно. */
  private recycleFarWorldProps(): void {
    const limit = this.promoteRadius() * 1.8;
    const doomed: { item: PropItem; rec: { group: THREE.Group; target: Target } }[] = [];
    for (const [item, rec] of this.worldProps) {
      const dx = item.x - this.pos.x, dz = item.z - this.pos.z;
      if (dx * dx + dz * dz <= limit * limit) continue;
      doomed.push({ item, rec });
    }
    if (!doomed.length) { this.world?.release(this.pos.x, this.pos.z, limit); return; }
    // собираем один раз: было O(пропов × мешей) внутри цикла
    const deadTargets = new Set<Target>();
    const deadMeshes = new Set<THREE.Mesh>();
    for (const d of doomed) {
      deadTargets.add(d.rec.target);
      d.rec.target.meshes.forEach((m) => deadMeshes.add(m));
      this.worldProps.delete(d.item);
    }
    this.targets = this.targets.filter((t) => !deadTargets.has(t));
    this.targetMeshes = this.targetMeshes.filter((m) => !deadMeshes.has(m));
    for (const d of doomed) {
      this.host.scene.remove(d.rec.group);
      this.disposeTree(d.rec.group);
    }
    this.world?.release(this.pos.x, this.pos.z, limit);
  }

  /**
   * Дистанция подгрузки реальных объектов. Умеренная: держать «живые» объекты
   * на сотни метров дорого, а проявление всё равно прячет туман.
   */
  private promoteRadius(): number {
    const byView = this.host.viewDistance ? this.host.viewDistance() : 70;
    return clamp(byView * 1.1, 45, 95);
  }

  /**
   * Радиус мира в чанках.
   *
   * Считается от видимости (дальность тумана) с запасом: мир должен существовать
   * ЗА пределами того, что видно, иначе на краю зрения пропы появляются «из
   * ниоткуда». Лёгкие батчи (инстансы) стоят почти ничего — по 1 draw call на
   * вид, поэтому радиус можно брать большой. Дорогие «живые» объекты (реальные
   * меши) подгружаются отдельно и только рядом — см. promoteRadius().
   */
  private worldRadiusChunks(): number {
    const byView = this.host.viewDistance ? this.host.viewDistance() : 70;
    const cs = this.worldCfg?.chunkSize ?? 24;
    // радиус 60% от видимости + запас 4 чанка (96 м)
    const chunks = Math.ceil((byView * 1.6) / cs);
    // если задана карта с границами — не генерируем дальше её радиуса
    const R = this.worldCfg?.worldRadius ?? 0;
    if (R > 0) {
      const mapChunks = Math.ceil((R * 1000) / cs);
      return clamp(Math.min(chunks, mapChunks), 4, 10);
    }
    return clamp(chunks, 4, 10);
  }

  /**
   * Начать вкарабкивание в мех: играет клип «лазание» (Climb_Wall или назначенный
   * вручную в панели «Анимации»), пилот подтягивается к меху, потом — в кабину.
   */
  private startClimb(id: string | undefined, group: THREE.Group, assetId: string): void {
    this.pendingSeat = { id: id ?? '__created__', group, assetId };
    this.climbPending = { id, group, assetId };
    this.climbT = 0;
    // точка старта + цель: лезем вдоль борта ВВЕРХ (к кабине), а не по земле
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    const gy = this.host.groundHeight(c.x, c.z);
    const h = Math.max(0.1, box.max.y - box.min.y);
    const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
    const dist = Math.hypot(dx, dz) || 1;
    const reach = Math.min(1.6, dist * 0.5); // встаём у борта, не в центре
    this.climbStart = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    this.climbGoal = {
      x: c.x + (dx / dist) * reach,
      y: Math.max(gy + 1.5, gy + h * 0.55), // поднимаемся к уровню кабины
      z: c.z + (dz / dist) * reach,
    };
    const clips = getPilotAnimationClips();
    const want = this.pilotClipMap?.jump ?? 'Climb_Wall';
    const clip = clips.find((c) => c.name === want) ?? clips.find((c) => c.name === 'Climb_Wall') ?? null;
    this.climbHasClip = !!clip;
    if (clip && this.pilot) {
      if (!this.pilotMixer) this.pilotMixer = new THREE.AnimationMixer(this.pilot);
      this.pilotMixer.stopAllAction();
      // фильтруем треки по наличию костей в модели (иначе PropertyBinding-спам)
      const safe = clip.clone();
      safe.tracks = clip.tracks.filter((tr) => {
        const prop = tr.name.split('.')[0];
        return !!this.pilot!.getObjectByName(prop);
      });
      if (!safe.tracks.length) { this.climbHasClip = false; this.climbMax = 0.5; return; }
      this.pilotAction = this.pilotMixer.clipAction(safe);
      this.pilotClipName = clip.name;
      const jumpMul = Math.max(0.2, this.pilotSpeeds.jump * (this.pilotSpeeds.global || 1));
      this.climbMax = Math.min(2.2, clip.duration / jumpMul);
      this.pilotAction.reset();
      this.pilotAction.setLoop(THREE.LoopOnce, 1);
      this.pilotAction.clampWhenFinished = true;
      this.pilotAction.setEffectiveTimeScale(jumpMul);
      this.pilotAction.play();
    } else {
      this.climbMax = 0.5; // без клипа — короткий рывок; потом перезапустимся
    }
  }

  /** Идёт ли вкарабкивание прямо сейчас. */
  get climbing(): boolean { return !!this.pendingSeat; }

  /** Продвижение вкарабкивания: пилот лезет ВВЕРХ вдоль борта, в конце — посадка. */
  private updateClimb(dt: number): void {
    const target = this.pendingSeat!;
    this.climbT += dt;
    // клипы ещё грузились — появились? перезапускаем, чтобы играло именно лазание
    if (!this.climbHasClip && this.climbPending && this.pilot) {
      const want = this.pilotClipMap?.jump ?? 'Climb_Wall';
      const clips = getPilotAnimationClips();
      const found = clips.find((c) => c.name === want) ?? clips.find((c) => c.name === 'Climb_Wall') ?? null;
      if (found) {
        this.startClimb(this.climbPending.id, this.climbPending.group, this.climbPending.assetId);
        return;
      }
    }
    if (this.pilotMixer) this.pilotMixer.update(dt);
    const t = this.climbMax > 0 ? Math.min(1, this.climbT / this.climbMax) : 1;
    const s = this.climbStart, g = this.climbGoal;
    if (s && g) {
      const e = t * t * (3 - 2 * t); // smoothstep — плавный подъём
      this.pos.x = s.x + (g.x - s.x) * e;
      this.pos.z = s.z + (g.z - s.z) * e;
      this.pos.y = s.y + (g.y - s.y) * e;
    } else {
      // запасной путь — как раньше: тянемся к центру меха
      const c = new THREE.Box3().setFromObject(target.group).getCenter(new THREE.Vector3());
      const gy = this.host.groundHeight(c.x, c.z);
      const a = Math.min(1, (1 - Math.exp(-3 * dt)) * 2);
      this.pos.x += (c.x - this.pos.x) * a;
      this.pos.z += (c.z - this.pos.z) * a;
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 10);
    }
    const gy = this.host.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < gy) this.pos.y = gy; // не проваливаться под землю
    if (this.pilot) {
      this.pilot.position.set(this.pos.x, this.pos.y - this.pilotFootDrop, this.pos.z);
      // лицом к меху, пока лезем
      const box = new THREE.Box3().setFromObject(target.group);
      const c = box.getCenter(new THREE.Vector3());
      this.pilot.rotation.y = Math.atan2(c.x - this.pos.x, c.z - this.pos.z);
    }
    this.updateCamera(dt);
    this.hudT += dt;
    if (this.hudT > 1 / 12) { this.hudT = 0; this.cb.onHud(this.buildHud()); }
    if (this.climbT >= this.climbMax + 0.15) {
      const done = this.pendingSeat;
      this.pendingSeat = null;
      this.climbStart = null;
      this.climbGoal = null;
      this.pilotMixer?.stopAllAction();
      this.pilotAction = null;
      this.pilotClipName = null;
      if (done) {
        if (done.id === '__created__') this.lastMech = { group: done.group, id: null, assetId: done.assetId };
        this.seatIn(done.group, done.id === '__created__' ? null : done.id, done.assetId);
      }
    }
  }

  /** Стриминг мира: радиус, генерация чанков, подъём пропов, утилизация дальних. */
  private updateWorldStream(dt: number): void {
    this.worldT += dt;
    this.host.updateWorldGround?.(this.pos.x, this.pos.z);
    if (this.worldT < 0.4) return;
    this.worldT = 0;
    // радиус мира — по видимости, с запасом: край мира не должен попадать в кадр
    this.world?.setRadius(this.worldRadiusChunks());
    this.world?.update(this.pos.x, this.pos.z);
    // Подгружаем дальше границы видимости: за туманом появление не заметно
    const reach = this.promoteRadius();
    for (const item of this.world?.takeNearby(this.pos.x, this.pos.z, reach) ?? []) {
      const def = getAsset(item.kind); if (!def) continue;
      const bk = this.world?.bakedOf(item.kind);
      let group: THREE.Group;
      if (bk && bk.parts.length) {
        // геометрия уже собрана для батчей — берём её, без аллокаций.
        // Внутренняя группа держит сдвиг: начало внешней — на земле, поэтому
        // при росте масштаба проп вырастает ИЗ земли, а не парит в воздухе.
        const s = item.s * bk.scale;
        group = new THREE.Group();
        group.userData.sharedGeo = true;
        const inner = new THREE.Group();
        inner.position.y = bk.yOffset;
        for (const p of bk.parts) {
          const m = new THREE.Mesh(p.geometry, p.material);
          m.receiveShadow = true;
          inner.add(m);
        }
        group.add(inner);
        group.scale.setScalar(s);
        group.rotation.y = item.rot;
        group.position.set(item.x, this.host.groundHeight(item.x, item.z), item.z);
      } else {
        // запасной путь: вид не запечён — собираем на лету
        const built = mergePropMeshes(def.build());
        const b = new THREE.Box3().setFromObject(built);
        group = new THREE.Group();
        const inner = new THREE.Group();
        inner.position.y = -b.min.y;
        inner.add(built);
        group.add(inner);
        group.scale.setScalar(item.s);
        group.rotation.y = item.rot;
        group.position.set(item.x, this.host.groundHeight(item.x, item.z), item.z);
      }
      const id = `world_${this.worldId++}`, meshes: THREE.Mesh[] = [];
      group.traverse((o) => {
        o.userData.objectId = id;
        const m = o as THREE.Mesh;
        // тени выключаем: вдали такой же проп рисуется instanced-батчем без теней,
        // иначе в момент подгрузки объект «вспыхивает» тенью
        if (m.isMesh) { m.castShadow = false; meshes.push(m); }
      });
      this.host.scene.add(group);
      const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3());
      const hp = HP_BY_ASSET[item.kind] ?? 30;
      const target: Target = { id, group, assetId: item.kind, name: def.name, category: def.category, role: 'prop', box, center, meshes, hp, maxHp: hp, radius: box.getSize(new THREE.Vector3()).length() / 2, solid: true, transient: true };
      this.targets.push(target);
      this.targetMeshes.push(...meshes);
      this.worldProps.set(item, { group, target });
      // БЕЗ анимации появления: проп уже был виден инстансом (тот же вид, та же
      // геометрия) — «вырастание из земли» игралось на глазах у игрока.
    }
    this.recycleFarWorldProps();
  }

  // ======================= update =======================
  update(dt: number) {
    // Вне кабины корпус всегда виден — иначе по нему нельзя кликнуть, чтобы сесть
    if (!this.ejected) this.mech.visible = this.view !== 'cockpit';
    if (this.tuning) { this.updateCamera(dt); return; }
    if (this.ejected) {
      // Пилот на ногах: мир продолжает жить (враги, снаряды, волны, эффекты),
      // иначе снаружи всё замирает — турели «застывают» в моменте.
      this.time += dt;
      this.updateWorldStream(dt);
      this.updateStamina(dt);
      this.updateFreeCamera(dt);
      this.updateProjectiles(dt);
      if (!this.over) { this.updateEnemies(dt); this.updateEproj(dt); this.updateWaves(dt); this.updateZones(); }
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.fx.update(dt);
    // тряска камеры затухает и пешком — иначе после выхода из меха «трясёт» вечно
    this.shake = Math.max(0, this.shake * Math.exp(-9 * dt));
    return;
  }
    this.time += dt;
    this.updateWorldStream(dt);
    this.updateMovement(dt);
    this.updateStamina(dt);
    this.updateLoose(dt);
    this.mech.updateMatrixWorld(true);
    this.updateAim();
    this.updateTorso(dt);
    this.updateRecoilPose(dt);
    this.mech.updateMatrixWorld(true);
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    if (!this.over) { this.updateEnemies(dt); this.updateEproj(dt); this.updateWaves(dt); }
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.fx.update(dt);
    this.updateCamera(dt);
    this.debugT += dt;
    if (this.collisionDebug && this.debugT > 0.12) {
      this.debugT = 0;
      this.collisionDebug.update(this.collisionShapes(), { position: this.pos, radius: this.chassisInfo.radius * 0.55, height: 4 });
    }
    this.hudT += dt;
    if (this.hudT > 1 / 12) { this.hudT = 0; this.cb.onHud(this.buildHud()); }
  }

  private updateMovement(dt: number) {
    const k = this.keys, ch = this.chassisInfo;
    const locked = this.over !== null;
    const gy = this.host.groundHeight(this.pos.x, this.pos.z);

    // правила движения живут в поведении «Движение»: настройки приходят из типа объекта
    let forward = 0;
    let turn = 0;
    if (!locked) {
      if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) turn += 1;
      if (k.has('KeyD') || k.has('ArrowRight')) turn -= 1;
    }
    const boosting = k.has('ShiftLeft') || k.has('ShiftRight');
    this.boostHeld = boosting;
    const st = stepMovement(
      { ...this.moveState, yaw: this.legYaw, y: this.airborne ? this.pos.y : gy },
      dt,
      { forward, turn, boost: boosting, jet: k.has('Space') },
      { groundY: gy, speedMul: ch.speedMul * this.balance.mechSpeed, turnMul: ch.turnMul, overheated: this.overheated, locked },
      this.moveCfg,
    );
    this.moveState = st;
    this.speed = st.speed;
    this.airborne = st.airborne;
    this.jetFuel = st.jetFuel;
    this.maxSpeedNow = (this.moveCfg.maxSpeed / 3.6) * ch.speedMul * (this.overheated ? 0.45 : 1);
    this.legYaw = wrap(st.yaw);
    this.previousPosition.copy(this.pos);
    const d = moveDistance(st.speed, this.legYaw, dt);
    this.pos.x += d.dx;
    this.pos.z += d.dz;
    this.pos.y = st.y;

    if (st.jumping) {
      this.jetT += dt; this.jetSfxT += dt;
      if (this.jetT > 0.03) {
        this.jetT = 0;
        const right = new THREE.Vector3(-Math.cos(this.legYaw), 0, Math.sin(this.legYaw));
        [-1, 1].forEach((s) => this.fx.jet(this.pos.clone().addScaledVector(right, s * ch.radius * 0.45).add(new THREE.Vector3(-Math.sin(this.legYaw) * 0.6, 0.9, -Math.cos(this.legYaw) * 0.6))));
        if (this.pos.y - gy < 2.5) this.fx.dust(new THREE.Vector3(this.pos.x, gy + 0.2, this.pos.z), 1.6, 0xa08560, 0.8, 0.9);
      }
      if (this.jetSfxT > 0.1) { this.jetSfxT = 0; sfx.jet(this.pos); }
    }
    if (st.landing > 0.15) {
      const hard = st.landing;
      for (let i = 0; i < 5; i++) this.fx.dust(new THREE.Vector3(this.pos.x, gy + 0.2, this.pos.z), 2 + hard * 2, 0xa08560, 1.2, 0.6);
      this.fx.ring(this.pos, 2 + hard * 3, 0xc0a080);
      this.shake += 0.3 * hard; sfx.land(this.pos); this.crushAt(this.pos, ch.radius);
    }
    this.collide();
    this.boundXZ(this.pos);

    // animation
    const ratio = Math.min(1, Math.abs(this.speed) / Math.max(0.5, this.maxSpeedNow));
    this.moveRatio = Math.max(ratio, Math.abs(turn) * 0.35);
    if (!this.airborne) this.legPhase += (Math.abs(this.speed) / 2.4 + Math.abs(turn) * 0.8) * dt * Math.PI;
    const stepIdx = Math.floor(this.legPhase / Math.PI);
    if (stepIdx !== this.lastStep) { this.lastStep = stepIdx; this.footstep(stepIdx % 2 === 0 ? 1 : -1); }
    animateLeg(this.legs[0], this.legPhase, this.moveRatio, dt, Math.sign(this.speed || 1), this.airborne);
    animateLeg(this.legs[1], this.legPhase + Math.PI, this.moveRatio, dt, Math.sign(this.speed || 1), this.airborne);
    this.bob = this.airborne ? 0 : Math.abs(Math.sin(this.legPhase)) * 0.12 * ratio;
    this.mech.position.set(this.pos.x, this.pos.y + this.footOffset + this.bob, this.pos.z);
    this.mech.rotation.set(-ratio * 0.05 * Math.sign(this.speed || 1), this.legYaw, Math.sin(this.legPhase) * 0.02 * ratio);
  }

  // ================= АНИМАЦИЯ МЕХА: СОСТОЯНИЯ ПО ДВИЖЕНИЮ И УРОНУ =================
  private boostHeld = false;
  private lastAnimState: MechAnimState = 'idle';
  /** Сила покачивания в покое — из настроек конкретного меха. */
  private idleSway = 1;
  setIdleSway(v: number) { this.idleSway = v; }

  /** Состояние анимации меха. Скорость — отдельно, знак говорит о движении назад. */
  animState(): { state: MechAnimState; timeScale: number; moving: boolean } {
    if (this.ejected) { this.lastAnimState = 'idle'; return { state: 'idle', timeScale: 0, moving: false }; }
    const dmg = this.pmax > 0 ? 1 - Math.max(0, this.php) / this.pmax : 0;
    const ratio = Math.min(1, Math.abs(this.speed) / Math.max(0.5, this.maxSpeedNow));
    const moving = ratio > 0.04;

    if (this.airborne) {
      this.lastAnimState = 'jump';
      // клип прыжка длиннее самого прыжка — ускоряем, чтобы совпало по времени
      // (дальше скорость каждого клипа крутится в панели «Анимации»)
      return { state: 'jump', timeScale: 1.9, moving: true };
    }
    // мех дышит на последнем издыхании — зомби-походка
    if (dmg >= 0.85) {
      this.lastAnimState = 'critical';
      return { state: 'critical', timeScale: moving ? 1 : 0, moving };
    }
    if (dmg >= 0.7) {
      this.lastAnimState = 'damaged';
      return { state: 'damaged', timeScale: moving ? 1 : 0, moving };
    }
    if (!moving) {
      this.lastAnimState = 'idle';
      return { state: 'idle', timeScale: 0, moving: false };
    }
    // Бег — только явный буст (Shift). По скорости судить нельзя: мех разгоняется
    // за полсекунды и мгновенно упирается в максимум.
    const run = this.boostHeld;
    this.lastAnimState = run ? 'run' : 'walk';
    // едем назад — крутим клип в обратную сторону, иначе ноги «едут» вперёд
    const dir = this.speed < -0.05 ? -1 : 1;
    const base = run ? 1.2 + ratio * 0.6 : 0.8 + ratio * 0.9;
    return { state: this.lastAnimState, timeScale: base * dir, moving: true };
  }

  private collide() {
    const r = this.chassisInfo.radius * 0.55;
    const destination = this.pos.clone(), delta = destination.clone().sub(this.previousPosition);
    const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / (r * 0.35)));
    this.pos.x = this.previousPosition.x; this.pos.z = this.previousPosition.z;
    for (let step = 0; step < steps; step++) {
      this.pos.x += delta.x / steps; this.pos.z += delta.z / steps;
      for (let pass = 0; pass < 3; pass++) this.resolveContacts(r);
    }
    this.processDestroy();
  }

  private resolveShape(shape: CollisionShape, r: number) {
    const contact = shape.contact(this.pos, r);
    if (!contact || contact.depth < 0.0001) return;
    const horizontal = Math.hypot(contact.normal.x, contact.normal.z);
    if (horizontal < 0.2) return;
    const nx = contact.normal.x / horizontal, nz = contact.normal.z / horizontal;
    this.pos.x += contact.normal.x * (contact.depth + 0.0005);
    this.pos.z += contact.normal.z * (contact.depth + 0.0005);
    const vx = Math.sin(this.legYaw) * this.speed;
    const vz = Math.cos(this.legYaw) * this.speed;
    const into = -(vx * nx + vz * nz);
    if (into > 0.1 && Math.abs(this.speed) > 0.01) {
      const headOn = Math.min(1, into / Math.abs(this.speed));
      this.speed *= 1 - headOn * 0.65;
    }
  }

  private resolveContacts(r: number) {
    for (const t of this.targets) {
      if (t.hp <= 0 || t.role === 'spawn') continue;
      if (t.enemy) { t.box.setFromObject(t.group); t.box.getCenter(t.center); }
      const b = t.box;
      const kind = interactionKind(t.assetId, t.contents);
      if (kind !== 'solid' && (propProfile(t.assetId).mass !== 'heavy' || kind === 'tree' || kind === 'explode')) {
        const contact = b.distanceToPoint(this.pos) < r + 4 ? objectCollision(t.group, this.host.groundHeight(t.center.x, t.center.z)).contact(this.pos, r) : null;
        if (contact && !this.airborne) {
          if (kind === 'tree') this.damage(t, t.hp);
          else if (propProfile(t.assetId).mass !== 'heavy' && Math.abs(this.speed) > 0.3) this.pushProp(t);
        }
        continue;
      }
      const prof = propProfile(t.assetId);
      if (prof.mass !== 'heavy') {
        if (b.distanceToPoint(this.pos) < r + 3 && Math.abs(this.speed) > 0.3 && objectCollision(t.group, this.host.groundHeight(t.center.x, t.center.z)).contact(this.pos, r)) this.pushProp(t, prof);
        continue;
      }
      if (this.pos.x < b.min.x - r || this.pos.x > b.max.x + r || this.pos.z < b.min.z - r || this.pos.z > b.max.z + r) continue;
      this.resolveShape(objectCollision(t.group, this.host.groundHeight(t.center.x, t.center.z)), r);
    }
    this.collideChunks();
    this.processDestroy();
  }

  /**
   * Collisions for baked procedural solid props (slabs, wrecks, walls) that are
   * never promoted to transient targets. Cheap AABB push-out with step-over.
   */
  private collideChunks(): void {
    if (!this.world) return;
    const r = this.chassisInfo.radius * 0.55;
    for (const item of this.world.solidQuery(this.pos.x, this.pos.z, 12)) {
      const b = this.world.boundsOf(item);
      if (!b) continue;
      if (this.pos.x < b.minX - r || this.pos.x > b.maxX + r || this.pos.z < b.minZ - r || this.pos.z > b.maxZ + r) continue;
      const shape = this.world.collisionOf(item); if (shape) this.resolveShape(shape, r);
    }
  }

  private footstep(side: number) {
    if (this.moveRatio < 0.05 || this.airborne) return;
    const right = new THREE.Vector3(-Math.cos(this.legYaw), 0, Math.sin(this.legYaw));
    const fp = this.pos.clone().addScaledVector(right, side * this.chassisInfo.radius * 0.5);
    this.mech.updateMatrixWorld(true);
    const ankle = this.legs[side > 0 ? 0 : 1]?.getObjectByName('ankle');
    if (ankle) ankle.getWorldPosition(fp);
    fp.y = this.host.groundHeight(fp.x, fp.z) + 0.15;
    this.crushAt(fp, this.chassisInfo.radius * 0.65);
    this.fx.dust(fp, 1.0 + this.chassisInfo.tonnage / 60, 0xa08560, 1.0, 0.5);
    this.shake += (this.view === 'cockpit' ? 0.025 : 0.008) * this.chassisInfo.tonnage / 50;
    sfx.step(this.chassisInfo.tonnage / 100, this.pos);
  }

  private crushAt(point: THREE.Vector3, radius: number) {
    for (const t of this.targets) {
      if (t.role === 'spawn' || t.hp <= 0) continue;
      const kind = interactionKind(t.assetId, t.contents);
      if (kind === 'solid') continue;
      const b = t.box;
      const dx = Math.max(b.min.x - point.x, 0, point.x - b.max.x);
      const dz = Math.max(b.min.z - point.z, 0, point.z - b.max.z);
      if (Math.hypot(dx, dz) <= radius && point.y <= b.max.y + 0.4 && point.y >= b.min.y - 0.5) {
        if (propProfile(t.assetId).squashable || kind === 'tree' || kind === 'explode') this.damage(t, t.hp);
        else this.pushProp(t, propProfile(t.assetId), t.center.x - point.x, t.center.z - point.z, 2);
      }
    }
    this.kickFrom(point, radius);
    this.processDestroy();
  }

  // ======================= loose prop physics =======================
  /** Promote a live target to a physics body with an impulse from the hull/motion. */
  private pushProp(t: Target, prof = propProfile(t.assetId), dirX?: number, dirZ?: number, boost = 1): void {
    if (this.loose.some((l) => l.target === t)) return;
    const imp = impactImpulse(
      this.pos.x, this.pos.z, Math.sin(this.legYaw) * this.speed, Math.cos(this.legYaw) * this.speed,
      { minX: t.box.min.x, maxX: t.box.max.x, minZ: t.box.min.z, maxZ: t.box.max.z },
      this.chassisInfo.tonnage, prof,
    );
    let nx = dirX ?? imp.nx, nz = dirZ ?? imp.nz;
    const length = Math.hypot(nx, nz); nx = length > 0.001 ? nx / length : imp.nx; nz = length > 0.001 ? nz / length : imp.nz;
    const mag = (dirX === undefined ? imp.mag : prof.kick * 2) * boost;
    if (mag <= 0.01) return;
    this.loose.push({
      target: t,
      vx: nx * mag, vz: nz * mag, vy: prof.mass === 'light' ? 1.2 + mag * 0.35 : 0,
      spin: (Math.random() - 0.5) * mag * (prof.rollable ? 2.2 : 0.9),
      airborne: prof.mass === 'light',
      yaw: t.group.rotation.y,
      baseScale: t.group.scale.x,
    });
    sfx.crush({ x: t.group.position.x, y: t.group.position.y, z: t.group.position.z });
  }

  /** Kick from a footstep/landing crush: light props fly away, squashable ones crumple. */
  private kickFrom(point: THREE.Vector3, radius: number): void {
    for (const t of this.targets) {
      if (t.role === 'spawn' || t.hp <= 0) continue;
      const prof = propProfile(t.assetId);
      if (prof.mass === 'heavy') continue;
      const dx = t.center.x - point.x, dz = t.center.z - point.z;
      const d = Math.hypot(dx, dz);
      if (d > radius * 2.2) continue;
      const kind = interactionKind(t.assetId, t.contents);
      const crush = kind !== 'solid' || prof.squashable;
      if (crush && prof.squashable) continue;
      const f = Math.max(0.25, 1 - d / (radius * 2.2));
      this.pushProp(t, prof, d > 1e-4 ? dx / d : 1, d > 1e-4 ? dz / d : 0, 2.5 * f + 0.5);
    }
    this.processDestroy();
  }

  private updateLoose(dt: number): void {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const l = this.loose[i];
      const t = l.target;
      if (!this.targets.includes(t) || t.hp <= 0) { this.loose.splice(i, 1); continue; }
      const prof = propProfile(t.assetId);
      const g = t.group;
      // integrate
      g.position.x += l.vx * dt;
      g.position.z += l.vz * dt;
      const damp = Math.exp(-PROP_DAMPING * dt);
      l.vx *= damp; l.vz *= damp;
      if (l.airborne) {
        l.vy -= PROP_GRAVITY * dt;
        g.position.y += l.vy * dt;
        const gy = this.host.groundHeight(g.position.x, g.position.z);
        t.box.setFromObject(g);
        if (t.box.min.y <= gy) {
          g.position.y += gy - t.box.min.y;
          if (Math.abs(l.vy) > 2) {
            l.vy = -l.vy * PROP_BOUNCE;
            this.fx.dust(g.position, 0.5, 0x9a8060, 0.5, 0.4);
          } else { l.vy = 0; l.airborne = false; }
        }
      } else {
        t.box.setFromObject(g);
        g.position.y += this.host.groundHeight(g.position.x, g.position.z) - t.box.min.y;
      }
      // roll or spin
      l.yaw += l.spin * dt;
      l.spin *= damp;
      g.rotation.y = l.yaw;
      if (prof.rollable) g.rotation.x += l.spin * dt * 0.5;
      // settle & cache-refresh
      if (!l.airborne && Math.hypot(l.vx, l.vz) < 0.05 && Math.abs(l.spin) < 0.05) {
        this.loose.splice(i, 1);
      }
      t.box.setFromObject(g);
      t.box.getCenter(t.center);
    }
  }

  private groundHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: THREE.Vector3): boolean {
    const gh = (d: number) => this.host.groundHeight(origin.x + dir.x * d, origin.z + dir.z * d);
    let prev = 0;
    for (let d = 1.5; d <= maxDist; d += 1.5) {
      if (origin.y + dir.y * d <= gh(d)) {
        let lo = prev, hi = d;
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (origin.y + dir.y * m <= gh(m)) hi = m; else lo = m; }
        out.copy(origin).addScaledVector(dir, hi); return true;
      }
      prev = d;
    }
    return false;
  }

  private findTarget(o: THREE.Object3D): Target | null {
    const id = o.userData.objectId as string | undefined;
    return id ? this.targets.find((t) => t.id === id) || null : null;
  }

  private updateAim() {
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    this.raycaster.near = 0.1; this.raycaster.far = 400;
    const ray = this.raycaster.ray;
    const hits = this.raycaster.intersectObjects(this.targetMeshes, false);
    const gp = new THREE.Vector3();
    const gHit = this.groundHit(ray.origin, ray.direction, 400, gp);
    const gDist = gHit ? ray.origin.distanceTo(gp) : Infinity;
    this.aimTarget = null;
    if (hits.length && hits[0].distance < gDist) { this.aimPoint.copy(hits[0].point); this.aimTarget = this.findTarget(hits[0].object); }
    else if (gHit) this.aimPoint.copy(gp);
    else this.aimPoint.copy(ray.origin).addScaledVector(ray.direction, 300);
    const dxz = Math.hypot(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
    if (dxz < this.chassisInfo.radius * 1.6) {
      const yaw = this.legYaw + this.torsoOffset;
      this.aimPoint.set(this.pos.x + Math.sin(yaw) * 40, this.pos.y + 2.5, this.pos.z + Math.cos(yaw) * 40);
      this.aimTarget = null;
    }
  }

  private updateTorso(dt: number) {
    const lim = THREE.MathUtils.degToRad(this.cfg.torsoTwist);
    let target: number;
    if (this.view === 'cockpit') { this.lookYaw = clamp(this.lookYaw, -lim, lim); target = this.lookYaw; }
    else target = clamp(wrap(Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z) - this.legYaw), -lim, lim);
    const rate = THREE.MathUtils.degToRad(170) * dt;
    const before = this.torsoOffset;
    this.torsoOffset += clamp(wrap(target - this.torsoOffset), -rate, rate);
    this.servoT -= dt;
    if (Math.abs(this.torsoOffset - before) > dt * 0.08 && this.servoT <= 0) { sfx.servo(Math.abs(this.torsoOffset - before) / Math.max(dt, 0.001), this.pos); this.servoT = 0.13; }
    if (this.torso) {
      // в покое корпус чуть покачивается — машина «гудит», а не стоит мёртво
      const st = this.animState();
      const sway = st.state === 'idle' ? this.idleSway : 0;
      if (sway > 0) {
        applyIdleSway(this.mech, { amount: sway, time: this.time, baseYaw: this.torsoOffset });
      } else {
        this.torso.rotation.y = this.torsoOffset;
      }
    }
    const mz = this.muzzleWorld(this.muzzles[0]);
    const pitch = clamp(Math.atan2(this.aimPoint.y - mz.y, Math.max(1, Math.hypot(this.aimPoint.x - mz.x, this.aimPoint.z - mz.z))), -0.55, 0.45);
    this.armPitch = damp(this.armPitch, pitch, 8, dt);
    this.arms.forEach((a) => { a.rotation.x = -this.armPitch; });
  }

  private muzzleWorld(o: THREE.Object3D | undefined): THREE.Vector3 {
    const v = new THREE.Vector3();
    if (o) o.getWorldPosition(v); else this.mech.getWorldPosition(v).add(new THREE.Vector3(0, 3.5, 1.5));
    return v;
  }
  private pickMuzzle(def: WeaponDef): THREE.Vector3 {
    if (def.kind === 'missile' && this.missileMuzzles.length) return this.muzzleWorld(this.missileMuzzles[this.muzzleIdx++ % this.missileMuzzles.length]);
    return this.muzzleWorld(this.muzzles[this.muzzleIdx++ % this.muzzles.length]);
  }

  // ======================= weapons =======================
  private updateWeapons(dt: number) {
    const heat: HeatState = { heat: this.heat, overheated: this.overheated, overheatT: this.overheatT };
    const { cooled } = tickWeapons(dt, this.slotCds, heat, this.weaponCfg);
    this.heat = heat.heat;
    this.overheated = heat.overheated;
    this.overheatT = heat.overheatT;
    if (cooled) this.pushLog('Реактор стабилен — системы восстановлены');
    if (!this.over) {
      if (this.lmb) this.tryFire(this.selected);
      if (this.rmb) this.slots.forEach((_, i) => this.tryFire(i));
    }
    for (let i = this.salvoQueue.length - 1; i >= 0; i--) {
      const q = this.salvoQueue[i]; q.t -= dt;
      if (q.t <= 0) { this.launch(this.slots[q.slot].def); this.applyRecoil(this.slots[q.slot].def, true); this.salvoQueue.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake * Math.exp(-9 * dt));
  }

  /** Visible recoil: gun mounts pitch up / kick back / jitter, driven by the real shot. */
  private applyRecoil(def: WeaponDef, missile = false): void {
    const strength = def.kind === 'beam' ? 0.55
      : def.id === 'mg' ? 0.18
      : def.kind === 'missile' ? 0.7
      : 0.95;
    const banks = missile ? this.missileRecoil : this.recoil;
    if (!banks.length) return;
    // alternate arms for projectile guns, all racks for missiles
    if (missile) banks.forEach((r) => r.kick(strength));
    else banks[Math.max(0, this.muzzleIdx - 1) % banks.length].kick(strength);
  }

  /** Per-frame recoil pose applied on top of aim pitch (recomputed, no drift). */
  private updateRecoilPose(dt: number): void {
    for (let i = 0; i < this.arms.length; i++) {
      const a = this.arms[i];
      const pose = this.recoil[i]?.update(dt);
      const base = -this.armPitch;
      if (pose) a.rotation.x = base - pose.pitch;
      else a.rotation.x = base;
    }
    for (let i = 0; i < this.missileRecoil.length; i++) {
      const pose = this.missileRecoil[i].update(dt), pod = this.missilePods[i];
      if (pod?.name === 'missile_pod') { pod.rotation.x = -pose.pitch * 0.3; pod.position.z = -0.2 - pose.back; }
    }
    for (const cannon of this.cannons) {
      const pose = this.recoil[0]?.update(0);
      cannon.rotation.x = -this.armPitch - (pose?.pitch ?? 0);
      cannon.position.z = 0.3 - (pose?.back ?? 0);
    }
  }

  private tryFire(i: number) {
    // правила стрельбы живут в поведении «Оружие»: темп, залп, патроны, перегрев
    const heat: HeatState = { heat: this.heat, overheated: this.overheated, overheatT: this.overheatT };
    const r = tryFireSlot(i, this.slotCds, heat, this.weaponCfg);
    if (!r.fired || !r.shot) {
      const cd = this.slotCds[i];
      const s = this.slots[i];
      if (cd && s && cd.ammo !== null && cd.ammo <= 0 && cd.cd <= 0) cd.cd = 0.4;
      return;
    }
    this.heat = heat.heat;
    this.overheated = heat.overheated;
    this.overheatT = heat.overheatT;
    this.shots++;

    const def = r.shot;
    const slot = this.slots[i];
    if (slot) slot.ammo = this.slotCds[i]?.ammo ?? slot.ammo;

    if (def.kind === 'missile') {
      for (let k = 0; k < r.salvoCount; k++) this.salvoQueue.push({ slot: i, t: k * 0.09 });
    } else {
      this.launch(def);
    }
    this.shake += def.kind === 'beam' ? 0.05 : def.id === 'mg' ? 0.03 : 0.12;
    if (def.kind !== 'missile') this.applyRecoil(def);
    sfx.shot(def.id, this.pos);
    if (r.overheated) {
      this.pushLog('ПЕРЕГРЕВ! Аварийное отключение реактора');
      sfx.overheat(this.pos);
    }
  }

  private launch(def: WeaponDef) {
    const mz = this.pickMuzzle(def);
    const dir = new THREE.Vector3().subVectors(this.aimPoint, mz).normalize();
    if (def.spread) dir.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(def.spread * 2)).normalize();
    this.fx.muzzleFlash(mz, def.color, def.kind === 'missile' ? 1.1 : def.id === 'mg' ? 0.8 : 1.7);
    // гильза вылетает из ствола вбок и звенит о землю — дешёвая деталь, но выстрел живой
    if (def.kind === 'projectile' || def.kind === 'beam') {
      const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      this.fx.casing(mz, side, def.id === 'mg' ? 0.8 : 1.2);
    }
    if (def.kind === 'beam') {
      this.raycaster.set(mz, dir); this.raycaster.near = 0; this.raycaster.far = def.range;
      const hits = this.raycaster.intersectObjects(this.targetMeshes, false);
      const gp = new THREE.Vector3(); const gh = this.groundHit(mz, dir, def.range, gp);
      const gd = gh ? mz.distanceTo(gp) : Infinity;
      let end: THREE.Vector3; let tgt: Target | null = null;
      if (hits.length && hits[0].distance < gd) { end = hits[0].point; tgt = this.findTarget(hits[0].object); }
      else if (gh) end = gp; else end = mz.clone().addScaledVector(dir, def.range);
      this.fx.beam(mz, end, def.color);
      if (tgt) this.hit(tgt, def.damage, end);
      else if (gh) { this.fx.dust(end, 1.2, 0x9a7a58, 0.9); this.fx.scorch(end, 0.6); }
    } else if (def.kind === 'projectile') {
      const mesh = this.fx.tracer(def.color, def.id === 'mg' ? 1.3 : 2.2, def.id === 'mg' ? 0.05 : 0.09);
      mesh.position.copy(mz); mesh.lookAt(mz.clone().add(dir));
      this.projectiles.push({ mesh, pos: mz.clone(), vel: dir.multiplyScalar(def.speed), def, life: def.range / def.speed, homing: null, trail: 0, kind: 'projectile' });
    } else if (def.kind === 'missile') {
      const g = this.fx.missile(); g.position.copy(mz);
      const v = dir.clone().add(new THREE.Vector3(0, 0.5, 0)).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6)).normalize().multiplyScalar(def.speed * 0.55);
      g.lookAt(mz.clone().add(v));
      this.projectiles.push({ mesh: g, pos: mz.clone(), vel: v, def, life: 7, homing: this.aimPoint.clone(), trail: 0, kind: 'missile' });
      this.fx.smoke(mz, 0.9, 1.0, 0x8a8078);
    }
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.life -= dt;
      if (p.kind === 'missile' && p.homing) {
        const des = new THREE.Vector3().subVectors(p.homing, p.pos).normalize().multiplyScalar(p.def.speed);
        p.vel.lerp(des, Math.min(1, 3.2 * dt));
        const sp = p.vel.length(); if (sp < p.def.speed) p.vel.multiplyScalar(Math.min(p.def.speed, sp + 45 * dt) / sp);
        p.trail += dt; if (p.trail > 0.03) { p.trail = 0; this.fx.smoke(p.pos, 0.45, 1.1, 0x9a9088); }
      }
      const dir = p.vel.clone().normalize();
      const stepLen = p.vel.length() * dt;
      this.raycaster.set(p.pos, dir); this.raycaster.near = 0; this.raycaster.far = stepLen + 0.4;
      const hits = this.raycaster.intersectObjects(this.targetMeshes, false);
      const next = p.pos.clone().addScaledVector(p.vel, dt);
      const gy = this.host.groundHeight(next.x, next.z);
      let done = false;
      if (hits.length) { this.impact(p, hits[0].point, this.findTarget(hits[0].object)); done = true; }
      else if (next.y <= gy) { next.y = gy + 0.05; this.impact(p, next, null); done = true; }
      else if (p.life <= 0 || Math.abs(next.x) > 160 || Math.abs(next.z) > 160) done = true;
      if (done) { this.fx.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
      p.pos.copy(next); p.mesh.position.copy(p.pos); p.mesh.lookAt(p.pos.clone().add(p.vel));
    }
  }

  private impact(p: Proj, point: THREE.Vector3, t: Target | null) {
    if (p.kind === 'missile') {
      this.fx.explosion(point, 1.1, { debris: 3 }); sfx.explosion(0.7, point); this.shake += 0.12;
      this.splash(point, 3.5, p.def.damage, t);
    } else if (t) this.hit(t, p.def.damage, point);
    else { this.fx.dust(point, 0.9, 0x9a7a58, 0.8); this.fx.sparks(point, 0xffc080, 5, 5); }
  }
  private hit(t: Target, dmg: number, point: THREE.Vector3) {
    // искры разлетаются и отскакивают от земли, пыль оседает
    this.fx.sparks(point, 0xffd090, 10, 7);
    this.fx.dust(point, 0.7, 0x8a7a68, 0.7, 0.4);
    sfx.hit(point);
    this.damage(t, dmg);
    this.processDestroy();
  }
  private splash(center: THREE.Vector3, radius: number, dmg: number, direct: Target | null) {
    for (const t of this.targets) {
      const d = Math.max(0, t.box.distanceToPoint(center));
      if (d < radius) this.damage(t, dmg * (1 - d / radius) * (t === direct ? 1.5 : 1));
    }
    this.processDestroy();
  }
  private damage(t: Target, amount: number) {
    if (t.hp <= 0 || !isFinite(t.maxHp)) return;
    t.hp -= amount * this.balance.dmgFromPlayer;
    if (t.enemy) { t.enemy.hp = t.hp; if (t.hp <= 0) t.enemy.alive = false; }
    if (t.hp <= 0) this.destroyQueue.push(t);
  }
  private processDestroy() {
    while (this.destroyQueue.length) {
      const t = this.destroyQueue.shift()!;
      if (!this.targets.includes(t)) continue;
      this.destroy(t);
    }
  }
  private destroy(t: Target) {
    this.targets = this.targets.filter((x) => x !== t);
    this.targetMeshes = this.targetMeshes.filter((m) => m.userData.objectId !== t.id);
    this.enemies = this.enemies.filter((e) => e !== t.enemy);
    if (this.aimTarget === t) this.aimTarget = null;
    // лут с мусора и детали при разборе машины — по настройкам сценария
    this.grantLoot(t);
    const mats = getSharedMaterials();
    const c = t.center.clone();
    const size = clamp(t.radius * 0.6, 0.8, 3);
    const reaction = interactionKind(t.assetId, t.contents);
    if (reaction === 'crush' || reaction === 'tree') this.fx.wreck(t.group, reaction === 'tree', this.legYaw);
    if (t.transient) {
      this.host.scene.remove(t.group);
      // геометрия может быть общей (из кэша батчей) — тогда не освобождаем
      const sharedGeo = !!t.group.userData.sharedGeo;
      t.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mm = Array.isArray(m.material) ? m.material : [m.material];
          mm.forEach((x) => { if (x && !x.userData?.shared) x.dispose(); });
          if (!sharedGeo && m.geometry) m.geometry.dispose();
        }
      });
    } else {
      this.host.destroyTarget(t.id);
    }
    this.kills++;
    this.pushLog(t.enemy ? `Враг уничтожен: ${t.name}` : `Цель уничтожена: ${t.name}`);
    if (reaction === 'crush' || reaction === 'tree') {
      this.fx.dust(c, 1.5, reaction === 'tree' ? 0x786044 : 0x9a8060, 0.8);
      if (reaction === 'tree') sfx.tree(c); else { sfx.crush(c); this.fx.sparks(c, 0xffbb77, 5, 3); }
      this.shake += 0.05; return;
    }
    if (reaction === 'explode') {
      this.fx.explosion(c, 2.3, { debrisMat: mats.rustOrange, debris: 10 });
      sfx.explosion(1.2, c); this.shake += 0.35;
      const distance = c.distanceTo(this.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      if (distance < 6) this.damagePlayer(45 * (1 - distance / 6));
      this.splash(c, 6, 45, null);
      return;
    }
    if (t.category === 'Укрытия' || t.category === 'Ландшафт') {
      this.fx.explosion(c, size, { fire: false, debrisMat: t.category === 'Укрытия' ? mats.concreteBroken : mats.rock, debris: 12 });
    } else {
      this.fx.explosion(c, size + 0.5, { debrisMat: t.category === 'Мехи' ? mats.mechArmor : mats.rustHeavy, debris: 12 });
    }
    sfx.explosion(size * 0.6, c); this.shake += 0.25 + size * 0.08;
    if (t.category === 'Мехи') this.splash(c, 5, 30, null);
  }

  // ======================= enemies & waves =======================
  /** Временные векторы для горячих циклов — без аллокаций в кадре. */
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _v4 = new THREE.Vector3();

  private enemiesAlive(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  private solidAt(x: number, z: number, r: number): boolean {
    for (const t of this.targets) {
      if (!t.solid) continue;
      const b = t.box;
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true;
    }
    return false;
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt, this.pos, (f) => this.spawnEnemyProj(f, e.group));
      e.updateWeaponAnim(dt);
    }
    this.separateEnemies();
    for (const t of this.targets) if (t.enemy) { t.box.setFromObject(t.group); t.box.getCenter(t.center); }
  }

  // light repulsion: strafing mechs don't merge into a heap
  private separateEnemies(): void {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.alive || a.kind === 'turret') continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.alive || b.kind === 'turret') continue;
        const p = a.group.position, q = b.group.position;
        const dx = q.x - p.x, dz = q.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 20.25 || d2 < 1e-6) continue; // closer than 4.5 м
        const d = Math.sqrt(d2), push = (4.5 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        p.x -= nx * push; p.z -= nz * push;
        q.x += nx * push; q.z += nz * push;
      }
    }
  }

  private spawnEnemyProj(f: { from: THREE.Vector3; dir: THREE.Vector3; speed: number; dmg: number }, shooter?: THREE.Object3D): void {
    const mesh = this.fx.tracer(0xff5040, 2.0, 0.08);
    mesh.position.copy(f.from);
    mesh.lookAt(f.from.clone().add(f.dir));
    this.eproj.push({ mesh, pos: f.from.clone(), vel: f.dir.clone().multiplyScalar(f.speed), dmg: f.dmg, life: 2.5, shooter });
  }

  /**
   * Вражеские снаряды.
   *
   * Раньше они проверяли только игрока и землю — пролетали сквозь плиты и
   * укрытия, от них не было смысла. Теперь снаряд гасится об укрытие (оно
   * получает урон и в конце концов разрушается), а попадание в игрока считается
   * по отрезку движения — быстрый снаряд больше не «проскакивает» сквозь мех.
   */
  private updateEproj(dt: number): void {
    const r = this.chassisInfo.radius * 0.8 + 0.6;
    const playerCenter = this._v1.set(this.pos.x, this.pos.y + 2, this.pos.z);
    for (let i = this.eproj.length - 1; i >= 0; i--) {
      const p = this.eproj[i];
      p.life -= dt;
      const next = p.pos.clone().addScaledVector(p.vel, dt);
      const dir = this._v2.copy(p.vel).normalize();
      const stepLen = p.vel.length() * dt;
      let done = false;

      // 1) укрытия: луч из точки выстрела на длину шага
      this.raycaster.set(p.pos, dir);
      this.raycaster.near = 0;
      this.raycaster.far = stepLen + 0.4;
      const hits = this.raycaster.intersectObjects(this.targetMeshes, false);
      // собственная модель стрелка не должна ловить его же снаряд
      let coverDist = Infinity;
      let coverHit: THREE.Intersection | null = null;
      for (const h of hits) {
        if (p.shooter && isChildOf(h.object, p.shooter)) continue;
        coverDist = h.distance;
        coverHit = h;
        break;
      }

      // 2) игрок: ближайшая точка отрезка до центра игрока
      const toPlayer = this._v3.copy(playerCenter).sub(p.pos);
      const along = toPlayer.dot(dir);
      const tHit = stepLen > 0.0001 ? THREE.MathUtils.clamp(along / stepLen, 0, 1) : 0;
      const closest = this._v4.copy(p.pos).addScaledVector(dir, tHit * stepLen);
      const playerDist = closest.distanceTo(playerCenter);
      const playerHit = playerDist < r && along < coverDist;

      if (coverHit && coverDist < along) {
        // укрытие поймало снаряд — принимает урон, трещит
        const t = this.findTarget(coverHit.object);
        this.fx.sparks(coverHit.point, 0xffc070, 6, 5);
        this.fx.dust(coverHit.point, 0.5, 0x8a7a68, 0.6, 0.3);
        sfx.hit(coverHit.point);
        if (t) { this.damage(t, p.dmg); this.processDestroy(); }
        done = true;
      } else if (playerHit) {
        this.fx.sparks(next, 0xff8060, 8, 6);
        // в меху — броня меха принимает урон, пилот страдает меньше
        if (!this.ejected && this.ownId) this.damageMech(p.dmg);
        else this.damagePlayer(p.dmg);
        done = true;
      } else if (next.y <= this.host.groundHeight(next.x, next.z)) {
        this.fx.dust(next, 0.7, 0x9a7a58, 0.7);
        done = true;
      } else if (p.life <= 0) done = true;
      if (done) { this.fx.remove(p.mesh); this.eproj.splice(i, 1); continue; }
      p.pos.copy(next); p.mesh.position.copy(p.pos);
    }
  }

  private damagePlayer(amount: number): void {
    if (this.over) return;
    this.php -= amount * this.balance.dmgToPlayer;
    this.hurt = 1;
    this.shake += 0.25;
    sfx.playerHurt(this.pos);
    if (this.php <= 0) {
      this.php = 0;
      this.over = 'lost';
      sfx.lose(this.pos);
      this.pushLog('Мех уничтожен. Esc — выход в редактор');
    }
  }

  private updateWaves(dt: number): void {
    const waves = this.scenario.waves;
    if (!waves.length || this.over) return;
    if (this.waveIdx + 1 < waves.length) {
      // the first wave comes on its timer no matter what; the rest wait for a clear field
      if (this.waveIdx === -1 || this.enemiesAlive() === 0) {
        this.waveT -= dt;
        if (this.waveT <= 0) this.startWave(this.waveIdx + 1);
      }
    } else if (this.enemiesAlive() === 0) {
      // grace-second: we give the last explosion time to play before the victory
      this.winT += dt;
      if (this.winT >= 1) {
        this.over = 'won';
        sfx.win(this.pos);
        this.pushLog('Все волны отражены. Победа! Esc — выход');
      }
    }
  }

  private startWave(i: number): void {
    const w = this.scenario.waves[i];
    if (!w) return;
    this.waveIdx = i;
    const n = Math.max(1, w.count | 0);
    for (let k = 0; k < n; k++) {
      const kind: EnemyKindId = w.kinds.length ? w.kinds[k % w.kinds.length] : 'mech_scout';
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
      const spawnPt = new THREE.Vector3(this.pos.x + Math.cos(a) * w.radius, 0, this.pos.z + Math.sin(a) * w.radius);
      this.boundXZ(spawnPt);
      const cx = spawnPt.x, cz = spawnPt.z;
      const group = this.host.spawnEnemy(kind === 'infantry' ? 'survivor' : kind, cx, cz);
      if (!group) continue;
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const meshes: THREE.Mesh[] = [];
      const id = 'wave_' + i + '_' + k;
      group.traverse((o) => { o.userData.objectId = id; if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const e = new Enemy(group, kind, id, {
        hpMul: this.scenario.enemyHpMul, dmgMul: this.scenario.enemyDmgMul,
        groundHeight: (x, z) => this.host.groundHeight(x, z),
        blocked: (x, z, r) => this.solidAt(x, z, r),
        fx: this.fx,
      });
      const npcCfg = this.scenario.npc;
      if (npcCfg) {
        e.setPatrol({
          enabled: kind !== 'turret' && npcCfg.enabled,
          radius: npcCfg.patrolRadius, speedMul: npcCfg.patrolSpeed, waypoints: npcCfg.waypoints,
          pauseSec: npcCfg.pauseSec, aggro: npcCfg.aggro, alertSec: npcCfg.alertSec,
          leash: npcCfg.leash, returnHome: npcCfg.returnHome,
        });
      }
      this.targets.push({
        id, group, name: 'Враг (' + w.name + ')', category: kind === 'infantry' ? 'Персонажи' : 'Мехи',
        assetId: kind === 'infantry' ? 'survivor' : kind, role: 'enemy',
        box, center, hp: e.hp, maxHp: e.maxHp, meshes,
        radius: Math.max(size.x, size.z) * 0.5, solid: kind !== 'turret', enemy: e, transient: true,
      });
      this.targetMeshes.push(...meshes);
      this.enemies.push(e);
    }
    this.pushLog('Волна ' + (i + 1) + '/' + this.scenario.waves.length + ': ' + w.name);
    const next = this.scenario.waves[i + 1];
    this.waveT = next ? next.delaySec : 0;
  }

  // ======================= зоны (цели) =======================
  /** Состав населённого пункта зоны — по её радиусу. */
  private zoneKinds(z: ZoneDef): EnemyKindId[] {
    if (z.r > 150) return ['mech_juggernaut', 'mech_molot', 'turret', 'infantry'];
    if (z.r > 80) return ['mech_scout', 'mech_molot', 'turret', 'infantry'];
    return ['mech_scout', 'infantry', 'turret'];
  }

  private spawnZoneEnemies(z: ZoneDef): void {
    const kinds = this.zoneKinds(z);
    const count = Math.max(4, Math.round(z.r / 22));
    for (let k = 0; k < count; k++) {
      const kind: EnemyKindId = kinds[Math.floor(Math.random() * kinds.length)];
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * z.r * 0.85;
      const spawnPt = new THREE.Vector3(z.x + Math.cos(a) * rr, 0, z.z + Math.sin(a) * rr);
      this.boundXZ(spawnPt);
      const cx = spawnPt.x, cz = spawnPt.z;
      const group = this.host.spawnEnemy(kind === 'infantry' ? 'survivor' : kind, cx, cz);
      if (!group) continue;
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const meshes: THREE.Mesh[] = [];
      const id = 'zone_' + z.id + '_' + k;
      group.traverse((o) => { o.userData.objectId = id; if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const e = new Enemy(group, kind, id, {
        hpMul: this.scenario.enemyHpMul, dmgMul: this.scenario.enemyDmgMul,
        groundHeight: (x, z) => this.host.groundHeight(x, z),
        blocked: (x, z, r) => this.solidAt(x, z, r),
        fx: this.fx,
      });
      const npcCfg = this.scenario.npc;
      if (npcCfg) {
        e.setPatrol({
          enabled: kind !== 'turret' && npcCfg.enabled,
          radius: npcCfg.patrolRadius, speedMul: npcCfg.patrolSpeed, waypoints: npcCfg.waypoints,
          pauseSec: npcCfg.pauseSec, aggro: npcCfg.aggro, alertSec: npcCfg.alertSec,
          leash: npcCfg.leash, returnHome: npcCfg.returnHome,
        });
      }
      this.enemyZone.set(e, z.id);
      group.userData.zoneId = z.id;
      this.targets.push({
        id, group, name: 'Враг (' + z.name + ')', category: kind === 'infantry' ? 'Персонажи' : 'Мехи',
        assetId: kind === 'infantry' ? 'survivor' : kind, role: 'enemy',
        box, center, hp: e.hp, maxHp: e.maxHp, meshes,
        radius: Math.max(size.x, size.z) * 0.5, solid: kind !== 'turret', enemy: e, transient: true,
      });
      this.targetMeshes.push(...meshes);
      this.enemies.push(e);
    }
  }

  /** Игровая логика зон: активация при входе, зачистка, победа. */
  private updateZones(): void {
    const defs = this.zoneDefs;
    if (!defs.length || this.over) return;
    // вошли в зону — активируем её население
    for (const z of defs) {
      if (this.zoneSpawned.has(z.id)) continue;
      const d = Math.hypot(z.x - this.pos.x, z.z - this.pos.z);
      if (d <= z.r) {
        this.zoneSpawned.add(z.id);
        this.spawnZoneEnemies(z);
        this.pushLog(`Зона «${z.name}»: враги обнаружены! Зачисти зону.`);
      }
    }
    // все ли активированные зоны очищены?
    let cleaned = 0;
    for (const z of defs) {
      if (!this.zoneSpawned.has(z.id)) continue;
      const left = this.enemies.filter((e) => this.enemyZone.get(e) === z.id && e.alive).length;
      if (left <= 0) cleaned++;
    }
    if (cleaned === defs.length) {
      this.over = 'won';
      this.pushLog('Все зоны очищены — контракт выполнен!');
      sfx.select(this.pos);
    }
  }

  /** Ближайшая незачищенная зона для HUD. */
  private zoneLabel(): { name: string; left: number } | null {
    let best: { name: string; left: number; d: number } | null = null;
    for (const z of this.zoneDefs) {
      if (!this.zoneSpawned.has(z.id)) continue;
      const left = this.enemies.filter((e) => this.enemyZone.get(e) === z.id && e.alive).length;
      if (left <= 0) continue;
      const d = Math.hypot(z.x - this.pos.x, z.z - this.pos.z);
      if (!best || d < best.d) best = { name: z.name, left, d };
    }
    return best ? { name: best.name, left: best.left } : null;
  }

  // ======================= camera =======================
  private updateCamera(dt: number) {
    const cam = this.host.camera, cfg = this.cfg;
    // вне кабины камера следит за пилотом, а не за корпусом меха
    const focus = this.ejected ? this.pos : this.mech.position;
    const mp = new THREE.Vector3(focus.x, focus.y, focus.z);
    const desired = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = 50, smooth = 10;
    if (this.view === 'cockpit') {
      const ci = this.chassisInfo.cockpit;
      desired.set(ci[0], ci[1] + cfg.cockpit.height, ci[2] + cfg.cockpit.forward);
      (this.torso || this.mech).localToWorld(desired);
      const sw = cfg.cockpit.sway * this.moveRatio;
      desired.y += Math.sin(this.legPhase * 2) * 0.035 * sw;
      const yaw = this.legYaw + this.torsoOffset, p = this.lookPitch;
      look.set(desired.x + Math.sin(yaw) * Math.cos(p), desired.y + Math.sin(p), desired.z + Math.cos(yaw) * Math.cos(p));
      fov = cfg.cockpit.fov * this.fovZoom; smooth = 80;
    } else {
      const yaw = this.camYaw;
      const autoFollow = !this.ejected && ((this.view === 'third' && cfg.third.autoFollow) || (this.view === 'tactical' && cfg.tactical.autoFollow));
      if (autoFollow && !this.mmb && Math.abs(this.speed) > 0.5) this.camYaw += wrap(this.legYaw - this.camYaw) * (1 - Math.exp(-1.6 * dt));
      const pitch = this.view === 'tactical' ? THREE.MathUtils.degToRad(cfg.tactical.pitch) : this.camPitch;
      const d = this.camDist;
      const h = this.ejected ? 1.5 : this.view === 'third' ? cfg.third.height : this.view === 'shoulder' ? cfg.shoulder.height : 1.5;
      look.set(mp.x, mp.y + h, mp.z);
      if (this.view === 'shoulder') look.addScaledVector(new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), cfg.shoulder.side);
      desired.set(look.x - Math.sin(yaw) * d * Math.cos(pitch), look.y + d * Math.sin(pitch), look.z - Math.cos(yaw) * d * Math.cos(pitch));
      fov = this.view === 'third' ? cfg.third.fov : this.view === 'shoulder' ? cfg.shoulder.fov : cfg.tactical.fov;
      smooth = this.view === 'third' ? cfg.third.smoothing : this.view === 'shoulder' ? 14 : 6;
    }
    const gy = this.host.groundHeight(desired.x, desired.z) + 0.6;
    if (desired.y < gy) desired.y = gy;
    if (!this.camInit) { this.camPosCur.copy(desired); this.camLookCur.copy(look); this.camInit = true; }
    const a = 1 - Math.exp(-smooth * dt);
    this.camPosCur.lerp(desired, a);
    this.camLookCur.lerp(look, this.view === 'cockpit' ? 1 : Math.min(1, a * 1.6));
    cam.position.copy(this.camPosCur);
    if (this.shake > 0.001) {
      const s = this.shake * (this.view === 'cockpit' ? 0.5 : 1);
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.camLookCur);
    if (this.view === 'cockpit') cam.rotateZ(Math.sin(this.legPhase) * 0.014 * cfg.cockpit.sway * this.moveRatio);
    const tf = THREE.MathUtils.lerp(cam.fov, fov, 1 - Math.exp(-8 * dt));
    if (Math.abs(tf - cam.fov) > 0.01) { cam.fov = tf; cam.updateProjectionMatrix(); }
  }

  // ======================= hud =======================
  /** Срез состояния для профайлера: что сейчас на экране и сколько всего живого. */
  perfStats() {
    return {
      enemies: this.enemiesAlive(),
      proj: this.projectiles.length,
      eproj: this.eproj.length,
      parts: this.fx.particleCount(),
      decals: this.fx.decalCount(),
      props: this.worldProps.size,
      x: Math.round(this.pos.x),
      z: Math.round(this.pos.z),
      view: this.view,
      heat: Math.round(this.heat),
      waves: this.waveIdx + 1,
      enemiesLeft: this.enemiesAlive(),
    };
  }

  private pushLog(msg: string) {
    const t = this.time;
    this.log.unshift(`[${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}] ${msg}`);
    if (this.log.length > 5) this.log.pop();
  }
  private buildHud(): HudState {
    return {
      view: this.view, vision: this.vision,
      speedKmh: Math.abs(this.speed) * 3.6, throttle: this.speed / Math.max(0.1, this.maxSpeedNow),
      heading: ((-this.legYaw * 180 / Math.PI) % 360 + 360) % 360,
      heat: this.heat, overheated: this.overheated, jetFuel: this.jetFuel, hasJets: this.cfg.jumpJets, airborne: this.airborne,
      weapons: this.slots.map((s, i) => ({ slot: i, id: s.def.id, name: s.def.name, short: s.def.short, ammo: s.ammo, ready: s.cd <= 0 ? 1 : 1 - s.cd * s.def.rof, selected: i === this.selected })),
      kills: this.kills, shots: this.shots, targetsLeft: this.targets.filter((t) => isFinite(t.maxHp)).length,
      log: [...this.log], pos: [this.pos.x, this.pos.z], yaw: this.legYaw,
      torsoOffsetDeg: this.torsoOffset * 180 / Math.PI,
      target: (!this.ejected && this.aimTarget && isFinite(this.aimTarget.maxHp)) ? { name: this.aimTarget.name, hp: this.aimTarget.hp / this.aimTarget.maxHp } : null,
      chassisName: this.chassisInfo.name, showHelp: this.showHelp, time: this.time,
      php: Math.max(0, Math.round(this.php)), pmax: this.pmax,
      mechHp: this.ejected ? 0 : Math.round(this.mechHp()),
      mechMaxHp: this.ejected ? 0 : this.mechMaxHp(),
      nearestMech: this.ejected ? this.nearestMechInfo() : null,
      zone: this.zoneLabel(),
      wave: this.waveIdx + 1, wavesTotal: this.scenario.waves.length,
      enemiesLeft: this.enemiesAlive(),
      over: this.over, hurt: Math.round(this.hurt * 100) / 100,
      ejected: this.ejected,
      stamina: this.cfg.vitals.stamina > 0 ? this.stamina / this.cfg.vitals.stamina : 0,
      bag: this.inventory.entries().map((e) => ({
        item: e.item, n: e.n, short: ITEMS[e.item].short, name: ITEMS[e.item].name,
      })),
      bagWeight: Math.round(this.inventory.weight() * 10) / 10,
      bagCapacity: this.cfg.vitals.carryKg,
      buildOptions: this.buildOptions(),
    };
  }
}