import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getAsset, getMechClips, getMechAnimationClips, clipForState, registerDynamicAsset, type MechAnimState } from './assets.ts';
import { getSharedMaterials, cloneMaterials, applyOverride } from './materials.ts';
import { getTextures } from './textures.ts';
import { PlayController } from './PlayController.ts';
import type { PlayCallbacks } from './PlayController.ts';
import { PostFX } from './effects.ts';
import { DEFAULT_MECH_CONFIG, DEFAULT_SCENARIO, mergeMechConfig } from './playTypes.ts';
import type { BarrelContents } from './interaction.ts';
import type { MechConfig, Scenario, WeaponId } from './playTypes.ts';
import { DEFAULT_WORLD_CONFIG } from './worldGen.ts';
import type { WorldConfig, EdgeType } from './worldGen.ts';
import { edgeHeight } from './worldGen.ts';
import { CollisionDebug, objectCollision, type CollisionShape } from './collision.ts';
import { propProfile } from './propPhysics.ts';
import { audio } from './audio.ts';
import { perf } from './perfLog.ts';
import { applyIdleSway } from './idleSway.ts';
import { sfx } from './sfx.ts';
import { DEFAULT_ENV, TIME_PRESETS, type EffectFlags, type EnvState } from './envDefaults.ts';
import { ensureProject, nextId, projectToJSON, type ProjectV2, type ActionSpec, type ConditionSpec, type EventRow, type EventSheet, type ExportedSound } from '../game/project.ts';
import { normObjectRole } from '../game/objectRole.ts';
import {
  findRow, moveRow, newRow, normalizeAction, normalizeCondition, removeRowFrom, updateRowIn,
} from '../game/sheets.ts';
import type { PropValues, PropValue } from '../game/props.ts';
import {
  findByCategory, findByRole, makeType, normalizeType, resolveType, wouldCycle,
  type ObjectType, type Role,
} from '../game/types.ts';
import { resolveRuntime } from './runtime/index.ts';
import {
  applyLook, buildMech, captureSculptDeltas, defaultMechSpec, mechSpecFor, presetsForPart, applyPartPreset, sculptMesh,
  type BrushMode, type BrushSettings, type MechSpec, type PartId, type PartPreset,
} from './mechRig.ts';

export { DEFAULT_ENV, TIME_PRESETS };
export type { EnvState, EffectFlags };

/**
 * Настройки анимаций ОДНОГО меха.
 * Множители скорости клипов по смыслу (не по именам файлов) + сила покачивания в покое.
 */
export interface MechAnimSettings {
  /** Множитель скорости клипа ходьбы. */
  walk: number;
  /** Множитель скорости клипа бега. */
  run: number;
  /** Множитель скорости клипа прыжка. */
  jump: number;
  /** Множитель скорости клипа «ранен» (Zombie_Walk). */
  damage: number;
  /** Множитель скорости клипа «на грани» (Zombie_Walk_2). */
  critical: number;
  /** Общий множитель всех клипов этого меха. */
  global: number;
  /** Сила механического покачивания корпуса в покое. */
  idle: number;
  /** Ручные назначения «состояние → клип» (панель «Анимации»). */
  clipMap?: Partial<Record<MechAnimState, string>>;
}

export const DEFAULT_MECH_ANIM: MechAnimSettings = {
  walk: 1, run: 1, jump: 1, damage: 1, critical: 1, global: 1, idle: 1,
};

export interface SceneObjectState {
  id: string;
  assetId: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  locked: boolean;
  /**
   * Роль объекта в превью:
   * player  — мех игрока (если задан, он главнее выбора в панели «Мех»)
   * reserve — резервный мех (в игру не водится, только запасной)
   * enemy   — враг
   * spawn   — точка появления игрока
   * prop    — декорация
   */
  role: 'prop' | 'enemy' | 'spawn' | 'player' | 'reserve';
  typeId?: string;
  contents?: BarrelContents;
  tint: string;
  rust: number;
  metalness: number;
  roughness: number;
  emissive: number;
  /** Параметрический риг меха: конструктор (размеры, части, скульптинг). */
  mechSpec?: MechSpec;
  /** Настройки анимаций этого меха (скорость шага/бега/прыжка, покачивание). */
  anim?: MechAnimSettings;
}


export interface EngineStats { fps: number; tris: number; calls: number; objects: number; }

interface Callbacks {
  onObjectsChange: (objs: SceneObjectState[]) => void;
  /** primary — активный объект, ids — всё выделение. */
  onSelect: (id: string | null, ids: string[]) => void;
  onStats: (s: EngineStats) => void;
}

let idCounter = 1;
function genId() { return 'obj_' + (idCounter++) + '_' + Math.floor(Math.random() * 10000).toString(36); }


export class EditorEngine {
  private container: HTMLElement;
  private cb: Callbacks;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  orbit!: OrbitControls;
  transform!: TransformControls;
  private transformHelper: THREE.Object3D | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private objects = new Map<string, { group: THREE.Group; state: SceneObjectState }>();
  private selectedId: string | null = null;
  /** Всё выделение. selectedId — активный объект (последний клик). */
  private selectedIds: string[] = [];
  private boxHelper: THREE.Box3Helper | null = null;
  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;
  private grid!: THREE.GridHelper;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private dustPoints!: THREE.Points;
  private dustData!: Float32Array;
  private skyDome!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private ghost: THREE.Group | null = null;
  private ghostAssetId: string | null = null;
  private ghostValid = true;
  private ghostYOffset = 0;
  env: EnvState = { ...DEFAULT_ENV };
  private history: string[] = [];
  private historyIdx = -1;
  private historyLock = false;
  private clock = new THREE.Clock();
  private animId = 0;
  private frames = 0;
  private lastFpsTime = performance.now();
  private fps = 60;
  private dragging = false;
  private downPos = { x: 0, y: 0 };
  transformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  // play mode
  play: PlayController | null = null;
  private postfx: PostFX | null = null;
  mechConfig: MechConfig = { ...DEFAULT_MECH_CONFIG };
  scenario: Scenario = JSON.parse(JSON.stringify(DEFAULT_SCENARIO)) as Scenario;
  world: WorldConfig = { ...DEFAULT_WORLD_CONFIG };
  project: ProjectV2 = ensureProject(null);
  private typeDirty = false;
  private playSnapshot = '';
  private spawnedMech: THREE.Group | null = null;
  private savedCam: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
  private playCallbacks: PlayCallbacks | null = null;
  private collisionDebug: CollisionDebug | null = null;
  private debugT = 0;
  private ro: ResizeObserver | null = null;

  constructor(container: HTMLElement, cb: Callbacks) {
    this.container = container;
    this.cb = cb;
  }

  init() {
    audio.init();
    audio.resume();
    sfx.init();
    // модель пилота грузим сразу, чтобы к началу превью она уже была готова
    // (загрузка идёт внутри pilotModel.ts при импорте модуля)
    void this.container;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.env.exposure;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.env.skyColor);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(this.env.skyColor), this.env.fogDensity);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 600);
    this.camera.position.set(14, 11, 16);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 2;
    this.orbit.maxDistance = 120;

    // lights
    this.sun = new THREE.DirectionalLight(0xffd9a8, this.env.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40; this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40; this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0xffc890, 0.25));
    this.hemi = new THREE.HemisphereLight(0xd88a4a, 0x2a2018, 0.55);
    this.scene.add(this.hemi);
    this.updateSun();

    this.buildSky();
    this.buildGround();
    this.buildGrid();
    this.buildDust();
    this.buildScatter();

    // transform controls
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    const tcAny = this.transform as unknown as { getHelper?: () => THREE.Object3D };
    if (typeof tcAny.getHelper === 'function') {
      this.transformHelper = tcAny.getHelper();
      this.scene.add(this.transformHelper);
    } else {
      this.scene.add(this.transform as unknown as THREE.Object3D);
    }
    this.transform.setMode(this.transformMode);
    this.transform.addEventListener('dragging-changed', ((e: { value: boolean }) => {
      this.dragging = e.value;
      this.orbit.enabled = !e.value;
      if (e.value) {
        // начало перетаскивания: запоминаем состояние всей группы
        this.beginGroupDrag();
      } else {
        if (this.groupDrag) {
          this.applyGroupTransform();
          this.groupDrag = null;
          this.attachGizmo(); // вернуть гизмо в центр группы
        } else {
          this.syncSelectedFromTransform();
        }
        if (this.partTransformTarget) this.emitObjects();
        this.pushHistory();
      }
    }) as never);
    this.transform.addEventListener('objectChange', () => {
      if (this.groupDrag) {
        // гизмо на прокси — двигаем всю группу
        this.applyGroupTransform();
      } else {
        this.syncSelectedFromTransform(true);
      }
      this.updateBoxHelper();
    });

    // events
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(this.container);
    }

    this.applyEnv();
    this.animate();
    this.pushHistory();
  }

  // ---------------- builders ----------------
  private buildSky() {
    const geo = new THREE.SphereGeometry(400, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color('#7a4a22') },
        horizonColor: { value: new THREE.Color(this.env.skyColor) },
        bottomColor: { value: new THREE.Color('#2a1d12') },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vPos; uniform vec3 topColor, horizonColor, bottomColor;
        void main(){ float h = normalize(vPos).y; vec3 c = h>0.0 ? mix(horizonColor, topColor, pow(h,0.55)) : mix(horizonColor, bottomColor, pow(-h,0.6));
        // sun glow band
        gl_FragColor = vec4(c,1.0); }`,
    });
    this.skyDome = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.skyDome);
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(240, 240, 120, 120);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      const flat = THREE.MathUtils.smoothstep(dist, 10, 45); // 0 center → 1 far
      const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) * 1.6
        + Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19) * 0.7
        + Math.sin(x * 0.6) * Math.cos(z * 0.55) * 0.22
        + (Math.random() - 0.5) * 0.14;
      // craters
      let crater = 0;
      const craters: [number, number, number, number][] = [[-28, -18, 7, 1.6], [24, 14, 5, 1.2], [-12, 30, 4, 0.9], [35, -25, 6, 1.4]];
      craters.forEach(([cx, cz, r, d]) => {
        const dd = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (dd < r) crater -= Math.cos((dd / r) * Math.PI * 0.5) * d;
      });
      pos.setY(i, (n + crater) * flat);
    }
    geo.computeVertexNormals();
    const T = getTextures();
    this.groundMat = new THREE.MeshStandardMaterial({
      map: T.ground, bumpMap: T.groundBump, bumpScale: 0.5,
      roughness: 0.97, metalness: 0.02, color: new THREE.Color(this.env.groundTint),
    });
    this.ground = new THREE.Mesh(geo, this.groundMat);
    this.ground.receiveShadow = true;
    this.ground.name = '__ground__';
    this.scene.add(this.ground);
  }

  private buildGrid() {
    this.grid = new THREE.GridHelper(80, 80, 0xff9a4a, 0x6a4a30);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.28;
    this.grid.position.y = 0.02;
    this.scene.add(this.grid);
  }

  private buildDust() {
    const COUNT = 2200;
    const positions = new Float32Array(COUNT * 3);
    this.dustData = new Float32Array(COUNT * 4); // speed, sway phase, sway amp, size var
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 160;
      positions[i * 3 + 1] = Math.random() * 22;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 160;
      this.dustData[i * 4] = 1.5 + Math.random() * 4;
      this.dustData[i * 4 + 1] = Math.random() * Math.PI * 2;
      this.dustData[i * 4 + 2] = 0.3 + Math.random() * 1.2;
      this.dustData[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const T = getTextures();
    const mat = new THREE.PointsMaterial({
      map: T.dustSprite, color: 0xe8b070, size: 1.1, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.dustPoints.frustumCulled = false;
    this.scene.add(this.dustPoints);
  }

  private buildScatter() {
    // instanced small rocks + debris across terrain
    const rockGeo = new THREE.IcosahedronGeometry(0.22, 0);
    const mats = getSharedMaterials();
    const inst = new THREE.InstancedMesh(rockGeo, mats.rock, 350);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 350; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 90;
      dummy.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
      dummy.position.y = this.groundHeight(dummy.position.x, dummy.position.z) + 0.05;
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const s = 0.4 + Math.random() * 1.6;
      dummy.scale.set(s, s * (0.5 + Math.random() * 0.6), s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
    // scrap bits
    const bitGeo = new THREE.BoxGeometry(0.5, 0.08, 0.3);
    const inst2 = new THREE.InstancedMesh(bitGeo, mats.rustHeavy, 220);
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 70;
      dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      dummy.position.y = this.groundHeight(dummy.position.x, dummy.position.z) + 0.05;
      dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
      const s = 0.4 + Math.random() * 1.4;
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      inst2.setMatrixAt(i, dummy.matrix);
    }
    inst2.castShadow = true; inst2.receiveShadow = true;
    this.scene.add(inst2);
  }

  groundHeight(x: number, z: number): number {
    // approximate same function as buildGround (without random)
    const dist = Math.sqrt(x * x + z * z);
    const flat = THREE.MathUtils.smoothstep(dist, 10, 45);
    const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) * 1.6
      + Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19) * 0.7
      + Math.sin(x * 0.6) * Math.cos(z * 0.55) * 0.22;
    let crater = 0;
    const craters: [number, number, number, number][] = [[-28, -18, 7, 1.6], [24, 14, 5, 1.2], [-12, 30, 4, 0.9], [35, -25, 6, 1.4]];
    craters.forEach(([cx, cz, r, d]) => {
      const dd = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
      if (dd < r) crater -= Math.cos((dd / r) * Math.PI * 0.5) * d;
    });
    // края карты: горы/скалы/вода/лес (если задан радиус мира)
    return (n + crater) * flat + edgeHeight(this.world, x, z);
  }

  // ---------------- environment ----------------
  private updateSun() {
    const ang = THREE.MathUtils.degToRad(this.env.sunAngle);
    const elev = this.env.timePreset === 'night' ? 0.5 : Math.sin(Math.max(ang, 0.12)) * 60 + 12;
    this.sun.position.set(Math.cos(ang) * 60, elev, Math.sin(ang) * 60);
  }

  setEnv(patch: Partial<EnvState>) {
    Object.assign(this.env, patch);
    this.applyEnv();
  }

  applyEnv() {
    const e = this.env;
    const fx: EffectFlags = { ...DEFAULT_ENV.fx, ...(e.fx ?? {}) };
    e.fx = fx;
    (this.scene.fog as THREE.FogExp2).color.set(e.skyColor);
    (this.scene.fog as THREE.FogExp2).density = fx.fog ? e.fogDensity : 0;
    (this.scene.background as THREE.Color).set(e.skyColor);
    this.skyMat.uniforms.horizonColor.value.set(e.skyColor);
    const top = new THREE.Color(e.skyColor).multiplyScalar(e.timePreset === 'night' ? 0.35 : 0.6);
    this.skyMat.uniforms.topColor.value.copy(top);
    this.skyDome.visible = fx.sky;
    this.sun.visible = fx.sun;
    this.sun.intensity = fx.sun ? e.sunIntensity : 0;
    this.sun.castShadow = fx.shadows && fx.sun;
    this.renderer.shadowMap.enabled = fx.shadows;
    this.sun.color.set(e.timePreset === 'night' ? 0x8aa8ff : e.timePreset === 'sunset' ? 0xff8a4a : 0xffd9a8);
    this.hemi.intensity = e.timePreset === 'night' ? 0.25 : 0.55;
    this.updateSun();
    this.renderer.toneMappingExposure = e.exposure;
    this.grid.visible = e.grid && !this.play;
    this.ground.visible = fx.ground;

    // Apply custom sound bindings
    audio.setBindings(e.soundBindings);
    this.groundMat.color.set(e.groundTint);
    const dustMat = this.dustPoints.material as THREE.PointsMaterial;
    dustMat.opacity = 0.12 + e.dust * 0.5;
    dustMat.color.set(e.timePreset === 'night' ? 0x5a6a8a : 0xe8b070);
    this.dustPoints.visible = fx.dust && e.dust > 0.02;
    this.transform.setTranslationSnap(e.snap ? e.snapSize : null);
    this.transform.setRotationSnap(e.snap ? THREE.MathUtils.degToRad(15) : null);
    this.transform.setScaleSnap(e.snap ? 0.1 : null);
    this.play?.setCollisionDebug(!!e.showCollisions && !this.play.tuning);
    this.syncCollisionDebug();
  }

  private syncCollisionDebug() {
    if (!this.env.showCollisions || this.play) {
      this.collisionDebug?.dispose();
      this.collisionDebug = null;
      return;
    }
    if (!this.collisionDebug) this.collisionDebug = new CollisionDebug(this.scene);
    const shapes: { shape: CollisionShape; movable: boolean }[] = [];
    this.objects.forEach(({ group, state }) => {
      if (!state.visible || state.role === 'spawn' || state.assetId.startsWith('mech_')) return;
      const gy = this.groundHeight(group.position.x, group.position.z);
      shapes.push({
        shape: objectCollision(group, gy),
        movable: propProfile(state.assetId).mass !== 'heavy' || state.assetId === 'dead_tree',
      });
    });
    this.collisionDebug.update(shapes);
  }

  // ---------------- objects ----------------
  private emitObjects() {
    this.cb.onObjectsChange(Array.from(this.objects.values()).map((o) => ({ ...o.state })));
    if (this.env.showCollisions && !this.play) this.syncCollisionDebug();
  }

  snapshot(): string {
    return JSON.stringify({
      env: this.env,
      objects: Array.from(this.objects.values()).map((o) => o.state),
    });
  }

  private pushHistory() {
    if (this.historyLock) return;
    this.history = this.history.slice(0, this.historyIdx + 1);
    this.history.push(this.snapshot());
    if (this.history.length > 60) this.history.shift();
    this.historyIdx = this.history.length - 1;
  }

  undo() {
    if (this.historyIdx <= 0) return;
    this.historyIdx--;
    this.restore(this.history[this.historyIdx]);
  }
  redo() {
    if (this.historyIdx >= this.history.length - 1) return;
    this.historyIdx++;
    this.restore(this.history[this.historyIdx]);
  }

  private restore(json: string) {
    this.historyLock = true;
    try {
      const data = JSON.parse(json);
      // NOTE: environment intentionally NOT restored — undo/redo affects objects only
      this.select(null);
      // remove all
      Array.from(this.objects.keys()).forEach((id) => this.removeObjectInternal(id));
      (data.objects as SceneObjectState[]).forEach((s) => this.spawnFromState(s));
      this.emitObjects();
    } finally { this.historyLock = false; }
  }

  private spawnFromState(s: SceneObjectState) {
    const def = getAsset(s.assetId);
    if (!def) return;
    const group = def.build();
    cloneMaterials(group);
    group.position.set(...s.position);
    group.rotation.set(THREE.MathUtils.degToRad(s.rotation[0]), THREE.MathUtils.degToRad(s.rotation[1]), THREE.MathUtils.degToRad(s.rotation[2]));
    group.scale.set(...s.scale);
    group.visible = s.visible;
    group.userData.objectId = s.id;
    group.traverse((o) => { o.userData.objectId = s.id; });
    this.applyStateMaterials(group, s);
    this.scene.add(group);
    const num = parseInt(s.id.split('_')[1] || '0', 10);
    if (!isNaN(num) && num >= idCounter) idCounter = num + 1;
    this.objects.set(s.id, { group, state: { ...s } });
  }

  private applyStateMaterials(group: THREE.Group, s: SceneObjectState) {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        applyOverride(mesh.material, { tint: s.tint, rust: s.rust, metalness: s.metalness, roughness: s.roughness, emissiveIntensity: s.emissive });
      }
    });
  }

  /** Lower a group so its bounding-box bottom touches the terrain */
  private dropGroupToGround(id: string) {
    const e = this.objects.get(id);
    if (!e) return;
    const gy = this.groundHeight(e.group.position.x, e.group.position.z);
    const box = new THREE.Box3().setFromObject(e.group);
    const dy = gy - box.min.y;
    e.group.position.y += dy;
    e.state.position[1] = +e.group.position.y.toFixed(3);
  }

  addAsset(assetId: string, at?: THREE.Vector3): string {
    const def = getAsset(assetId);
    if (!def) return '';
    const id = genId();
    const p = at ? at.clone() : new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
    p.y = this.groundHeight(p.x, p.z);
    const state: SceneObjectState = {
      id, assetId, name: def.name,
      position: [p.x, p.y, p.z], rotation: [0, Math.floor(Math.random() * 8) * 45, 0], scale: [def.scale || 1, def.scale || 1, def.scale || 1],
      visible: true, locked: false, role: 'prop', tint: '#ffffff', rust: 0.35, metalness: 0.5, roughness: 0.75, emissive: 1.0,
      typeId: this.defaultTypeIdFor(assetId),
    };
    this.spawnFromState(state);
    this.dropGroupToGround(id);
    this.emitObjects();
    this.select(id);
    this.pushHistory();
    return id;
  }

  /** Дублировать всё выделение. */
  duplicateSelected() {
    if (!this.selectedId) return;
    const ids = [...this.selectedIds];
    const made: string[] = [];
    ids.forEach((srcId, i) => {
      const src = this.objects.get(srcId);
      if (!src) return;
      const id = genId();
      const s: SceneObjectState = {
        ...src.state, id, name: src.state.name + (ids.length > 1 ? ` (копия ${i + 1})` : ' (копия)'),
        position: [src.state.position[0] + 1.5, src.state.position[1], src.state.position[2] + 1.5],
      };
      this.spawnFromState(s);
      made.push(id);
    });
    if (!made.length) return;
    this.emitObjects();
    this.setSelection(made, made[made.length - 1]);
    this.pushHistory();
  }

  /** Удалить всё выделение. */
  deleteSelected() {
    const ids = [...this.selectedIds];
    if (!ids.length) return;
    ids.forEach((id) => this.removeObjectInternal(id));
    this.selectedIds = [];
    this.selectedId = null;
    this.transform.detach();
    this.updateBoxHelper();
    this.emitObjects();
    this.cb.onSelect(null, []);
    this.pushHistory();
  }
  deleteObject(id: string) {
    this.removeObjectInternal(id);
    if (this.selectedId === id) this.select(null);
    this.emitObjects();
    this.pushHistory();
  }

  private removeObjectInternal(id: string) {
    const o = this.objects.get(id);
    if (!o) return;
    const mixerEntry = this.animMixers.get(id);
    if (mixerEntry) {
      mixerEntry.action.stop();
      mixerEntry.mixer.uncacheRoot(o.group);
      this.animMixers.delete(id);
    }
    if (this.transform.object === o.group) this.transform.detach();
    this.scene.remove(o.group);
    o.group.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => { const t = m as THREE.MeshStandardMaterial; if (t.map && !Object.values(getTextures()).includes(t.map as never)) t.map?.dispose(); m.dispose(); });
      }
    });
    this.objects.delete(id);
  }

  clearAll() {
    Array.from(this.objects.keys()).forEach((id) => this.removeObjectInternal(id));
    this.select(null);
    this.emitObjects();
    this.pushHistory();
  }

  // ---------------- selection & transform ----------------
  /**
   * Выделение.
   *  select(id)            — выделить один объект
   *  select(id, true)      — Ctrl: добавить/убрать из выделения
   *  select(null, true)    — Ctrl+клик по пустому месту: снять всё
   */
  select(id: string | null, additive = false) {
    if (id && !this.objects.get(id)) id = null;
    if (additive) {
      if (id) {
        const i = this.selectedIds.indexOf(id);
        if (i >= 0) this.selectedIds.splice(i, 1);
        else this.selectedIds.push(id);
        this.selectedId = id;
      } else {
        this.selectedIds = [];
        this.selectedId = null;
      }
    } else {
      this.selectedIds = id ? [id] : [];
      this.selectedId = id;
    }
    this.attachGizmo();
    this.updateBoxHelper();
    this.cb.onSelect(this.selectedId, [...this.selectedIds]);
  }

  /** Выделить несколько объектов разом (рамка выделения). */
  private setSelection(ids: string[], primary?: string) {
    this.selectedIds = [...new Set(ids)];
    this.selectedId = primary ?? (this.selectedIds.length ? this.selectedIds[this.selectedIds.length - 1] : null);
    this.attachGizmo();
    this.updateBoxHelper();
    this.cb.onSelect(this.selectedId, [...this.selectedIds]);
  }

  getSelectedId() { return this.selectedId; }
  getSelectedIds() { return [...this.selectedIds]; }
  get selectionCount() { return this.selectedIds.length; }

  selectAll() {
    const ids = Array.from(this.objects.values())
      .filter((o) => o.state.visible && !o.state.locked)
      .map((o) => o.state.id);
    this.setSelection(ids);
  }

  deselectAll() { this.select(null); }

  // ---- гизмо: один объект — сам объект, несколько — прокси в центре группы ----
  private multiProxy: THREE.Object3D | null = null;
  private groupDrag: {
    center: THREE.Vector3;
    proxyPos: THREE.Vector3;
    proxyQuat: THREE.Quaternion;
    proxyScale: THREE.Vector3;
    start: Map<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
  } | null = null;

  private attachGizmo() {
    const ids = this.selectedIds;
    if (ids.length === 0) { this.transform.detach(); return; }
    if (ids.length === 1) {
      const rec = this.objects.get(ids[0]);
      if (rec && !rec.state.locked) this.transform.attach(rec.group);
      else this.transform.detach();
      return;
    }
    // группа: гизмо висит на прокси в центре выделения
    if (!this.multiProxy) { this.multiProxy = new THREE.Object3D(); this.scene.add(this.multiProxy); }
    this.multiProxy.position.copy(this.selectionCenter());
    this.multiProxy.rotation.set(0, 0, 0);
    this.multiProxy.scale.set(1, 1, 1);
    this.multiProxy.updateMatrixWorld(true);
    this.transform.attach(this.multiProxy);
  }

  /** Центр выделения (по bounding box объектов). */
  private selectionCenter(): THREE.Vector3 {
    const box = new THREE.Box3();
    let any = false;
    for (const id of this.selectedIds) {
      const rec = this.objects.get(id);
      if (!rec) continue;
      const b = new THREE.Box3().setFromObject(rec.group);
      if (b.isEmpty()) continue;
      if (!any) { box.copy(b); any = true; } else box.union(b);
    }
    if (!any) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3());
  }

  /** Запомнить состояние группы перед перетаскиванием гизмо. */
  private beginGroupDrag() {
    if (this.selectedIds.length < 2 || !this.multiProxy) { this.groupDrag = null; return; }
    const start = new Map<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>();
    for (const id of this.selectedIds) {
      const rec = this.objects.get(id);
      if (!rec) continue;
      start.set(id, {
        position: [...rec.state.position] as [number, number, number],
        rotation: [...rec.state.rotation] as [number, number, number],
        scale: [...rec.state.scale] as [number, number, number],
      });
    }
    this.groupDrag = {
      center: this.selectionCenter(),
      proxyPos: this.multiProxy.position.clone(),
      proxyQuat: this.multiProxy.quaternion.clone(),
      proxyScale: this.multiProxy.scale.clone(),
      start,
    };
  }

  /** Применить трансформацию прокси ко всем выделенным объектам. */
  private applyGroupTransform() {
    const g = this.groupDrag;
    if (!g || !this.multiProxy) return;
    const dPos = this.multiProxy.position.clone().sub(g.proxyPos);
    const dQuat = this.multiProxy.quaternion.clone().multiply(g.proxyQuat.clone().invert());
    const dScale = new THREE.Vector3(
      Math.abs(g.proxyScale.x) > 1e-6 ? this.multiProxy.scale.x / g.proxyScale.x : 1,
      Math.abs(g.proxyScale.y) > 1e-6 ? this.multiProxy.scale.y / g.proxyScale.y : 1,
      Math.abs(g.proxyScale.z) > 1e-6 ? this.multiProxy.scale.z / g.proxyScale.z : 1,
    );
    const base = g.center.clone().add(dPos);
    g.start.forEach((st, id) => {
      const rec = this.objects.get(id);
      if (!rec) return;
      const rel = new THREE.Vector3(...st.position).sub(g.center).multiply(dScale).applyQuaternion(dQuat);
      rec.group.position.copy(base).add(rel);
      const startQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(st.rotation[0]),
        THREE.MathUtils.degToRad(st.rotation[1]),
        THREE.MathUtils.degToRad(st.rotation[2]),
      ));
      rec.group.quaternion.copy(dQuat).multiply(startQuat);
      rec.group.scale.set(st.scale[0] * dScale.x, st.scale[1] * dScale.y, st.scale[2] * dScale.z);
      rec.state.position = [+rec.group.position.x.toFixed(3), +rec.group.position.y.toFixed(3), +rec.group.position.z.toFixed(3)];
      rec.state.rotation = [
        +THREE.MathUtils.radToDeg(rec.group.rotation.x).toFixed(2),
        +THREE.MathUtils.radToDeg(rec.group.rotation.y).toFixed(2),
        +THREE.MathUtils.radToDeg(rec.group.rotation.z).toFixed(2),
      ];
      rec.state.scale = [+rec.group.scale.x.toFixed(3), +rec.group.scale.y.toFixed(3), +rec.group.scale.z.toFixed(3)];
    });
    this.emitObjects();
  }

  private updateBoxHelper() {
    if (this.boxHelper) { this.scene.remove(this.boxHelper); this.boxHelper.dispose(); this.boxHelper = null; }
    if (!this.selectedId) return;
    // рамка вокруг всей группы
    const box = new THREE.Box3();
    let any = false;
    for (const id of this.selectedIds) {
      const rec = this.objects.get(id);
      if (!rec) continue;
      const b = new THREE.Box3().setFromObject(rec.group);
      if (b.isEmpty()) continue;
      if (!any) { box.copy(b); any = true; } else box.union(b);
    }
    if (!any) return;
    const helper = new THREE.Box3Helper(box, 0xffa030);
    (helper.material as THREE.Material).depthTest = false;
    helper.renderOrder = 999;
    this.scene.add(helper);
    this.boxHelper = helper;
  }

  private syncSelectedFromTransform(emit = false) {
    if (this.partTransformTarget) {
      this.updateMechPartTransform();
      if (emit) this.emitObjects();
      return;
    }
    if (!this.selectedId) return;
    const e = this.objects.get(this.selectedId);
    if (!e) return;
    const g = e.group;
    e.state.position = [+g.position.x.toFixed(3), +g.position.y.toFixed(3), +g.position.z.toFixed(3)];
    e.state.rotation = [
      +THREE.MathUtils.radToDeg(g.rotation.x).toFixed(2),
      +THREE.MathUtils.radToDeg(g.rotation.y).toFixed(2),
      +THREE.MathUtils.radToDeg(g.rotation.z).toFixed(2),
    ];
    e.state.scale = [+g.scale.x.toFixed(3), +g.scale.y.toFixed(3), +g.scale.z.toFixed(3)];
    if (emit) this.emitObjects();
  }

  setTransformMode(m: 'translate' | 'rotate' | 'scale') {
    this.transformMode = m;
    this.transform.setMode(m);
    // у группы сбрасываем накопленные поворот/масштаб прокси — иначе оси гизмо
    // останутся «повёрнутыми» от прошлой операции
    if (this.multiProxy && this.selectedIds.length > 1) {
      this.multiProxy.rotation.set(0, 0, 0);
      this.multiProxy.scale.set(1, 1, 1);
      this.multiProxy.position.copy(this.selectionCenter());
      this.multiProxy.updateMatrixWorld(true);
    }
  }

  updateObject(id: string, patch: Partial<SceneObjectState>, commit = false) {
    const e = this.objects.get(id);
    if (!e) return;
    Object.assign(e.state, patch);
    const s = e.state, g = e.group;
    if (patch.position) g.position.set(...s.position);
    if (patch.rotation) g.rotation.set(THREE.MathUtils.degToRad(s.rotation[0]), THREE.MathUtils.degToRad(s.rotation[1]), THREE.MathUtils.degToRad(s.rotation[2]));
    if (patch.scale) g.scale.set(...s.scale);
    if (patch.visible !== undefined) g.visible = s.visible;
    if (patch.tint !== undefined || patch.rust !== undefined || patch.metalness !== undefined || patch.roughness !== undefined || patch.emissive !== undefined) {
      this.applyStateMaterials(g, s);
    }
    if (patch.locked !== undefined) {
      if (s.locked) this.transform.detach();
      else if (this.selectedId === id) this.transform.attach(g);
    }
    this.updateBoxHelper();
    this.emitObjects();
    if (commit) this.pushHistory();
  }

  focusSelected() {
    if (!this.selectedIds.length) return;
    const box = new THREE.Box3();
    let any = false;
    for (const id of this.selectedIds) {
      const rec = this.objects.get(id);
      if (!rec) continue;
      const b = new THREE.Box3().setFromObject(rec.group);
      if (b.isEmpty()) continue;
      if (!any) { box.copy(b); any = true; } else box.union(b);
    }
    if (!any) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.orbit.target.copy(center);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.camera.position.copy(center).add(dir.multiplyScalar(Math.max(size * 1.4, 4)));
  }

  /** Опустить на землю: активный объект или всё выделение. */
  dropToGround() {
    const ids = this.selectedIds.length ? [...this.selectedIds] : (this.selectedId ? [this.selectedId] : []);
    if (!ids.length) return;
    ids.forEach((id) => {
      const e = this.objects.get(id);
      if (!e) return;
      const y = this.groundHeight(e.group.position.x, e.group.position.z);
      const box = new THREE.Box3().setFromObject(e.group);
      const dy = y - box.min.y;
      this.updateObject(id, { position: [+e.group.position.x.toFixed(3), +(e.group.position.y + dy).toFixed(3), +e.group.position.z.toFixed(3)] }, true);
    });
    this.emitObjects();
  }

  // ---------------- placement ghost ----------------
  startPlacement(assetId: string) {
    this.cancelPlacement();
    const def = getAsset(assetId);
    if (!def) return;
    this.ghostAssetId = assetId;
    this.ghost = def.build();
    // offset so ghost bottom touches ground (mechs' origin is above feet)
    const gbox = new THREE.Box3().setFromObject(this.ghost);
    this.ghostYOffset = -gbox.min.y;
    this.ghost.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x54ff9a, transparent: true, opacity: 0.45, depthWrite: false });
        mesh.castShadow = mesh.receiveShadow = false;
      } else if ((o as THREE.Sprite).isSprite) { o.visible = false; }
    });
    this.scene.add(this.ghost);
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  cancelPlacement() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.ghostAssetId = null;
    this.renderer.domElement.style.cursor = '';
  }

  isPlacing() { return !!this.ghostAssetId; }

  // ---------------- PLAY MODE (preview) ----------------
  isPlaying() { return !!this.play; }
  ejectMech() { this.play?.eject(); }
  enterMech(objectId: string) { this.play?.enterMech(objectId); }
  setMechConfig(cfg: MechConfig) {
    const changeChassis = this.play?.tuning && cfg.chassis !== this.mechConfig.chassis;
    this.mechConfig = mergeMechConfig(cfg);
    this.project = { ...this.project, player: this.mechConfig };
    // Панель «Мех» и «Типы объектов → Поведения» — два вида на одни настройки:
    // пишем правку в тип, чтобы превью не перекрывало её поведениями.
    if (!this.play) this.saveMechConfigToType();
    if (changeChassis && this.playCallbacks) {
      const callbacks = this.playCallbacks;
      this.stopPlay();
      this.startPlay({ ...this.mechConfig, playerObjectId: 'new', defaultView: 'cockpit' }, this.scenario, callbacks, true);
    } else this.play?.setConfig(this.mechConfig);
  }
  setScenario(s: Scenario) {
    this.scenario = JSON.parse(JSON.stringify(s)) as Scenario;
    this.emitObjects();
  }

  setWorld(cfg: Partial<WorldConfig>) {    const merged = this.clampWorld({ ...this.world, ...cfg }, this.world);
    let changed = false;
    (Object.keys(merged) as (keyof WorldConfig)[]).forEach((k) => {
      if (merged[k] !== this.world[k]) changed = true;
    });
    if (changed) this.world = merged;
  }

  private clampWorld(c: Partial<WorldConfig>, base: WorldConfig): WorldConfig {
    const num = (v: unknown, min: number, max: number, def: number) =>
      typeof v === 'number' && isFinite(v) ? THREE.MathUtils.clamp(v, min, max) : def;
    const edges: EdgeType[] = ['none', 'mountains', 'cliffs', 'water', 'forest'];
    return {
      seed: typeof c.seed === 'number' && isFinite(c.seed) ? Math.max(0, Math.floor(c.seed)) : base.seed,
      chunkSize: num(c.chunkSize, 8, 64, base.chunkSize),
      propDensity: num(c.propDensity, 0, 4, base.propDensity),
      oasisChance: num(c.oasisChance, 0, 0.5, base.oasisChance),
      worldRadius: num(c.worldRadius, 0, 8, base.worldRadius),
      edgeType: edges.includes(c.edgeType as EdgeType) ? (c.edgeType as EdgeType) : base.edgeType,
      zones: Array.isArray(c.zones) ? c.zones.filter((z) => z && typeof z.x === 'number' && typeof z.z === 'number' && typeof z.r === 'number') : (base.zones ?? []),
      randomSpawn: c.randomSpawn === true,
      enabled: c.enabled !== false,
    };
  }

  /**
   * Импорт меха из GLB (отредактированного в Blender) в текущую сессию.
   * Модель приводится к росту ~4.8 м, ставится на землю и появляется в сцене.
   * ВАЖНО: ассет временный — живёт до перезагрузки страницы.
   * Для постоянного использования положи файл в public/library/ и добавь в реестр.
   */
  importGlbAsMech(name: string, url: string): string {
    const id = "mech_custom_" + Date.now();
    const group = new THREE.Group();
    const build = () => group;
    registerDynamicAsset({
      id, name: name || "Мех (импорт)", category: "Мехи",
      desc: "Импортировано из GLB (Blender), временный ассет сессии.",
      build, gltf: true,
    });
    const loader = new GLTFLoader();
    loader.load(url, (glb) => {
      if (!glb.scene) return;
      const scene = glb.scene.clone(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const s = Math.max(0.001, 4.8 / Math.max(0.001, size.y));
      scene.scale.setScalar(s);
      scene.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y; // ноги на y=0
      group.add(scene);
      this.updateObject?.(id, {}, false);
      this.emitObjects();
    }, undefined, (err) => console.warn("GLB import error", err));
    const at = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(9));
    at.y = 0;
    const objectId = this.addAsset(id, at);
    if (objectId) {
      // импортированный мех сразу становится мехом игрока (если игрок ещё не назначен)
      const hasPlayer = Array.from(this.objects.values()).some((o) => o.state.role === 'player' && o.state.assetId.startsWith('mech_'));
      if (!hasPlayer) this.updateObject(objectId, { role: 'player' }, true);
    }
    return objectId;
  }

  startPlay(config: MechConfig, scenario: Scenario, cbs: PlayCallbacks, tuning = false): boolean {
    if (this.play) return false;
    this.playCallbacks = cbs;
    this.mechConfig = { ...config };
    this.scenario = JSON.parse(JSON.stringify(scenario)) as Scenario;
    this.cancelPlacement();
    this.select(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.playSnapshot = this.snapshot();
    this.savedCam = { pos: this.camera.position.clone(), target: this.orbit.target.clone(), fov: this.camera.fov };
    this.orbit.enabled = false;
    this.transform.enabled = false;
    this.grid.visible = false;
    if (this.world.enabled !== false) this.buildWorldGround();

    // choose player mech
    let mech: THREE.Group | null = null;
    let chassis = config.chassis;
    let ownId: string | null = null;
    const mechs = Array.from(this.objects.values()).filter((o) => o.state.assetId.startsWith('mech_') && o.state.visible);
    let pick: { group: THREE.Group; state: SceneObjectState } | null = null;
    // 1) объект с ролью «Мех игрока» — самое явное назначение, оно главнее списка
    const byRole = mechs.find((o) => o.state.role === 'player');
    // 2) резервные мехи в авто-выборе не участвуют
    const candidates = mechs.filter((o) => o.state.role !== 'reserve');
    if (byRole) pick = byRole;
    else if (config.playerObjectId === 'auto') pick = candidates[0] || null;
    else if (config.playerObjectId !== 'new') {
      const wanted = this.objects.get(config.playerObjectId);
      pick = wanted && wanted.state.visible && wanted.state.assetId.startsWith('mech_') ? wanted : null;
    }
    if (pick && pick.state.assetId.startsWith('mech_')) {
      mech = pick.group; chassis = pick.state.assetId; ownId = pick.state.id;
    } else {
      const def = getAsset(chassis) || getAsset('mech_scout')!;
      mech = def.build();
      cloneMaterials(mech);
      const t = this.orbit.target;
      mech.position.set(t.x, 0, t.z);
      const box = new THREE.Box3().setFromObject(mech);
      mech.position.y = this.groundHeight(t.x, t.z) - box.min.y;
      this.scene.add(mech);
      this.spawnedMech = mech;
    }
    this.animOwnId = ownId;
    // анимируется только мех игрока: у остальных (в т.ч. у резервных) режим выключен
    this.animMixers.forEach((entry, id) => {
      if (id === ownId) return;
      entry.action.stop();
      entry.action.reset();
    });

    const host = {
      scene: this.scene, camera: this.camera, dom: this.renderer.domElement,
      groundHeight: (x: number, z: number) => this.groundHeight(x, z),
      updateWorldGround: (x: number, z: number) => this.updateWorldGround(x, z),
      // Дальность, за которой объект растворяется в тумане — подгружаем дальше неё
      viewDistance: () => {
        const fog = this.scene.fog as THREE.FogExp2 | null;
        const d = this.env.fx.fog ? (fog?.density ?? 0) : 0;
        if (d <= 0) return this.camera.far;
        // FogExp2: видимость ~ 1/d, берём с запасом
        return Math.min(this.camera.far, 1 / d);
      },
      getTargets: () => Array.from(this.objects.values()).filter((o) => o.state.visible).map((o) => ({
        id: o.state.id, group: o.group, name: o.state.name, category: getAsset(o.state.assetId)?.category || '', assetId: o.state.assetId,
        role: o.state.role || 'prop', contents: o.state.contents,
      })),
      destroyTarget: (id: string) => { this.removeObjectInternal(id); this.emitObjects(); },
      spawnEnemy: (assetId: string, x: number, z: number) => {
        const def = getAsset(assetId);
        if (!def) return null;
        const group = def.build();
        cloneMaterials(group);
        group.position.set(x, this.groundHeight(x, z), z);
        const box = new THREE.Box3().setFromObject(group);
        group.position.y += this.groundHeight(x, z) - box.min.y;
        this.scene.add(group);
        return group;
      },
    };
    // Персонаж для пешего режима: выбранный объект, иначе первый «пилот/выживший» в сцене
    const HUMAN_IDS = ['pilot', 'pilot_human', 'survivor'];
    const humans = Array.from(this.objects.values()).filter((o) => o.state.visible && HUMAN_IDS.includes(o.state.assetId));
    let pilotObj: THREE.Group | null = null;
    if (config.pilotObjectId && config.pilotObjectId !== 'auto' && config.pilotObjectId !== 'new') {
      pilotObj = this.objects.get(config.pilotObjectId)?.group ?? null;
    }
    if (!pilotObj && config.pilotObjectId !== 'new') {
      // роль «Пилот игрока» главнее простого авто-выбора первого персонажа
      pilotObj = (humans.find((h) => h.state.role === 'player') ?? humans[0])?.group ?? null;
    }
    let pilotId: string | null = null;
    if (pilotObj) {
      // если на сценного пилота играет редакторский микшер — глушим:
      // анимацией ходьбы/бега под управлением занимается PlayController
      pilotId = Array.from(this.objects.entries()).find(([, v]) => v.group === pilotObj)?.[0] ?? null;
      if (pilotId) this.animMixers.delete(pilotId);
    }

    this.play = new PlayController(host, config, cbs, mech, chassis, ownId, this.scenario, this.world, pilotObj, pilotId);
    if (pilotId) this.play.setPilotAnim(this.animSettingsOf(pilotId));
    // настройки анимаций — у конкретного меха игрока
    if (ownId) this.play.setIdleSway(this.animSettingsOf(ownId).idle ?? 1);
    // Ф2: правила движения и оружия приходят из поведений типа объекта.
    // Перед стартом подтягиваем их в конфиг, чтобы HUD и панель «Мех»
    // показывали ровно то, с чем реально поедет превью.
    this.applyPlayerType();
    this.play.setRuntime(resolveRuntime(this.playerTypeId(), this.project.types));
    this.play.tuning = tuning;
    if (tuning) this.play.view = 'cockpit';
    this.collisionDebug?.dispose();
    this.collisionDebug = null;
    this.play.start();
    this.play.setCollisionDebug(!!this.env.showCollisions && !tuning);
    return true;
  }

  // ---------------- конструктор меха ----------------
  /** Живой мех: пересобрать по спецификации, сохранив позицию объекта.
   *  notify=false — не трогать React-состояние (для плавного протягивания слайдера). */
  rebuildMech(objectId: string, spec: MechSpec, notify = true): boolean {
    const rec = this.objects.get(objectId);
    if (!rec) return false;
    // GLB-мех нельзя пересобрать процедурным ригом — потеряем скелет и клипы
    if (getAsset(rec.state.assetId)?.gltf) return false;
    const fresh = buildMech(spec);
    applyLook(fresh, rec.state.tint, rec.state.metalness, rec.state.roughness);
    fresh.position.copy(rec.group.position);
    fresh.rotation.copy(rec.group.rotation);
    // Масштаб НЕ копируем: buildMech уже запекает spec.size в риг.
    // Если копировать — каждое движение слайдера умножало бы размер на себя.
    fresh.scale.setScalar(1);
    fresh.visible = rec.group.visible;
    fresh.userData.objectId = objectId;
    // Старая группа сейчас исчезнет из сцены — гизмо обязано её отпустить,
    // иначе TransformControls каждый кадр ругается, что объект вне сцены
    if (this.transform.object === rec.group) this.transform.detach();
    this.scene.add(fresh);
    this.scene.remove(rec.group);
    this.disposeRebuiltGroup(rec.group);
    rec.group = fresh;
    rec.state = { ...rec.state, mechSpec: spec };
    if (this.selectedId === objectId && !rec.state.locked) this.transform.attach(fresh);
    this.updateBoxHelper();
    if (notify) this.emitObjects();
    return true;
  }

  /** Зафиксировать правку меха: обновить дерево/инспектор и записать в undo. */
  commitMechEdit(): void {
    this.emitObjects();
    this.pushHistory();
  }

  /** Освободить геометрию и клоны материалов снятой группы. Текстуры общие — не трогаем. */
  private disposeRebuiltGroup(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => mat?.dispose());
    });
  }

  /** Спецификация объекта (создаётся по умолчанию, если меха ещё не редактировали). */
  mechSpecOf(objectId: string): MechSpec | null {
    const rec = this.objects.get(objectId);
    if (!rec) return null;
    return rec.state.mechSpec ?? mechSpecFor(rec.state.assetId);
  }

  /** Пресеты деталей для части, доступные в панели конструктора. */
  mechPartPresets(partId: PartId): PartPreset[] {
    return presetsForPart(partId);
  }

  /** Применить пресет детали к меху. */
  applyMechPartPreset(objectId: string, preset: PartPreset): boolean {
    const rec = this.objects.get(objectId);
    if (!rec) return false;
    const prev = this.mechSpecOf(objectId) ?? mechSpecFor(rec.state.assetId);
    const spec = applyPartPreset(prev, preset);
    rec.state = { ...rec.state, mechSpec: spec };
    this.rebuildMech(objectId, spec);
    this.pushHistory();
    return true;
  }

  // ---------------- АНИМАЦИИ (миксер на объекте сцены) ----------------
  private animMixers = new Map<string, { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; clip: THREE.AnimationClip }>();

  /** Все доступные клипы (из загруженного GLB). */
  getAnimationClips(): THREE.AnimationClip[] {
    return getMechAnimationClips();
  }

  /** Проиграть клип на объекте сцены. */
  playAnimation(objectId: string, clipName: string): boolean {
    const rec = this.objects.get(objectId);
    if (!rec) return false;
    // клипы ищем среди клипов ассета объекта (у каждого меха свой набор)
    const own = getMechClips(rec.state.assetId);
    const clip = own.find((c) => c.name === clipName)
      ?? getMechAnimationClips().find((c) => c.name === clipName);
    if (!clip) return false;
    let entry = this.animMixers.get(objectId);
    if (!entry) {
      const mixer = new THREE.AnimationMixer(rec.group);
      entry = { mixer, action: mixer.clipAction(clip), clip };
      this.animMixers.set(objectId, entry);
    } else if (entry.clip !== clip) {
      // другой клип — новое действие; старое глушим
      entry.mixer.stopAllAction();
      entry.action = entry.mixer.clipAction(clip);
      entry.clip = clip;
    }
    entry.mixer.stopAllAction();
    entry.action.reset();
    entry.action.setEffectiveTimeScale(this.clipSpeedOf(objectId, clip.name));
    entry.action.setLoop(this.animLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    entry.action.play();
    return true;
  }

  stopAnimation(objectId: string) {
    const entry = this.animMixers.get(objectId);
    if (!entry) return;
    entry.mixer.stopAllAction();
    entry.action.reset();
  }

  isAnimating(objectId: string): boolean {
    const entry = this.animMixers.get(objectId);
    return !!entry && entry.action.isRunning();
  }

  getAnimationTime(objectId: string): number {
    const entry = this.animMixers.get(objectId);
    return entry ? entry.action.time : 0;
  }

  setAnimationTime(objectId: string, t: number) {
    const entry = this.animMixers.get(objectId);
    if (!entry) return;
    entry.action.time = Math.max(0, Math.min(t, entry.clip.duration));
  }

  /** Записать текущие настройки анимаций (скорости клипов, покой) в проект. */
  saveAnimSettings(): void {
    this.project = { ...this.project, player: this.mechConfig };
  }

  setAnimationSpeed(speed: number) {
    this.animSpeed = speed;
    this.animMixers.forEach((e, id) => e.action.setEffectiveTimeScale(this.clipSpeedOf(id, e.clip.name)));
  }

  /** Клип для состояния: ручное назначение (clipMap) главнее авто-подбора по смыслу. */
  private resolveClipState(objectId: string, st: MechAnimState): THREE.AnimationClip | null {
    const rec = this.objects.get(objectId);
    const assetId = rec?.state.assetId ?? '';
    // idle: только если у ассета реально есть клип покоя (иначе стойка, а не «шаг»)
    const auto = clipForState(assetId, st);
    const over = this.animSettingsOf(objectId).clipMap?.[st];
    if (over) {
      const oc = getMechClips(assetId).find((c) => c.name === over);
      if (oc) return oc;
    }
    return auto;
  }

  /**
   * Множитель скорости клипа для объекта:
   * ползунок состояния (ходьба/бег/прыжок/ранен) × общий ползунок меха × локальный ползунок превью.
   */
  private clipSpeedOf(objectId: string, clipName: string): number {
    const rec = this.objects.get(objectId);
    const a = { ...DEFAULT_MECH_ANIM, ...(rec?.state.anim ?? {}) };
    let byState = 1;
    const states: [MechAnimState, 'walk' | 'run' | 'jump' | 'damage' | 'critical' | 'idle'][] = [
      ['idle', 'idle'], ['walk', 'walk'], ['run', 'run'], ['jump', 'jump'], ['damaged', 'damage'], ['critical', 'critical'],
    ];
    for (const [st, key] of states) {
      const c = this.resolveClipState(objectId, st);
      if (c && c.name === clipName) { byState = a[key] ?? 1; break; }
    }
    const mul = byState * (a.global || 1) * (this.animSpeed ?? 1);
    return mul > 0.001 ? mul : 1;
  }

  setAnimationLoop(loop: boolean) {
    this.animLoop = loop;
    this.animMixers.forEach((e) => e.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity));
  }

  getAnimationSpeed() { return this.animSpeed; }
  getAnimationLoop() { return this.animLoop; }

  private animSpeed = 1;
  private animLoop = true;
  /** Мех, которому сейчас вешается анимация (меняется при выходе/посадке). */
  private animOwnId: string | null = null;

  /** Настройки анимаций объекта (с дефолтами). */
  animSettingsOf(objectId: string): MechAnimSettings {
    const rec = this.objects.get(objectId);
    return { ...DEFAULT_MECH_ANIM, ...(rec?.state.anim ?? {}) };
  }

  /** Записать настройки анимаций объекта. */
  setAnimSettings(objectId: string, patch: Partial<MechAnimSettings>): void {
    const rec = this.objects.get(objectId);
    if (!rec) return;
    const next = { ...DEFAULT_MECH_ANIM, ...(rec.state.anim ?? {}), ...patch };
    this.updateObject(objectId, { anim: next }, true);
    // превью живёт: настройки пилота — прямо в контроллер
    if (this.play && this.play.pilotObjectId === objectId) {
      this.play.setPilotAnim(next);
    }
    // живой отклик: у играющих в редакторе клипов обновляем скорость сразу
    this.animMixers.forEach((entry, id) => {
      entry.action.setEffectiveTimeScale(this.clipSpeedOf(id, entry.clip.name));
    });
  }

  /** Применить состояние анимации (из PlayController) к меху игрока. */
  private applyPlayAnimation() {
    if (!this.play) return;
    // мех мог смениться: игрок вышел и сел в другой — анимация идёт за текущим
    const currentId = this.play.currentMechId;
    if (currentId !== this.animOwnId) {
      // прежний мех замирает в позе, а не продолжает шагать
      if (this.animOwnId) {
        const old = this.animMixers.get(this.animOwnId);
        if (old) { old.action.setEffectiveTimeScale(0); }
      }
      this.animOwnId = currentId;
    }
    if (!currentId) return;
    const st = this.play.animState();
    const rec = this.objects.get(currentId);
    if (!rec) return;
    // в покое держим позу ходьбы (timeScale 0) — иначе GLB-мех стоит в T-позе
    const clip = this.resolveClipState(currentId, st.state);
    const entry = this.animMixers.get(currentId);
    if (!clip) {
      // стоим — держим текущую позу (время клипа замирает)
      if (entry) entry.action.setEffectiveTimeScale(0);
      return;
    }
    // скорость: множитель состояния × общий множитель меха
    const a = this.animSettingsOf(currentId);
    const byState = st.state === 'run' ? a.run
      : st.state === 'jump' ? a.jump
      : st.state === 'critical' ? a.critical
      : st.state === 'damaged' ? a.damage
      : a.walk;
    const mul = (byState || 1) * (a.global || 1);
    // в покое Idle-клип играет с обычной скоростью (иначе он застынет около st.timeScale=0)
    const scale = st.state === 'idle' ? (mul > 0.001 ? mul : 1) : st.timeScale * (mul > 0.001 ? mul : 1);
    if (!entry || entry.clip.name !== clip.name) {
      this.playAnimation(currentId, clip.name);
      const e2 = this.animMixers.get(currentId);
      if (e2) {
        // прыжок проигрывается один раз, ходьба — по кругу
        e2.action.setLoop(st.state === 'jump' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        e2.action.setEffectiveTimeScale(scale);
      }
    } else {
      entry.action.setEffectiveTimeScale(scale);
    }
  }

  // ---------------- выбор отдельной детали (гезмо на деталь) ----------------

  private partTransformTarget: { objectId: string; partId: PartId; mesh: THREE.Mesh } | null = null;

  /** Луч в мех: первая деталь под курсором. */
  pickMechPart(objectId: string, clientX: number, clientY: number): { objectId: string; partId: PartId; point: THREE.Vector3; mesh: THREE.Mesh } | null {
    const rec = this.objects.get(objectId);
    if (!rec) return null;
    const dom = this.renderer.domElement;
    const r = dom.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(rec.group.children, true);
    for (const h of hits) {
      const m = h.object as THREE.Mesh;
      const partId = m.userData.partId as PartId | undefined;
      if (partId) return { objectId, partId, point: h.point, mesh: m };
    }
    return null;
  }

  /** Прицепить гизмо на отдельную деталь меха. */
  selectMechPart(objectId: string, partId: PartId): boolean {
    const rec = this.objects.get(objectId);
    if (!rec) return false;
    let target: THREE.Mesh | null = null;
    rec.group.traverse((o) => {
      if (target) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.partId === partId) target = m;
    });
    if (!target) return false;
    this.transform.detach();
    this.partTransformTarget = { objectId, partId, mesh: target };
    this.transform.attach(target);
    this.updateBoxHelper();
    return true;
  }

  /** Отпустить гизмо детали и вернуть на весь мех (если он выделен). */
  deselectMechPart(): void {
    this.transform.detach();
    this.partTransformTarget = null;
    if (this.selectedId) {
      const rec = this.objects.get(this.selectedId);
      if (rec && !rec.state.locked) this.transform.attach(rec.group);
    }
    this.updateBoxHelper();
  }

  /** Записать текущий трансформ выбранной детали в спецификацию (вызывается при перетаскивании). */
  updateMechPartTransform(): void {
    const t = this.partTransformTarget;
    if (!t) return;
    const rec = this.objects.get(t.objectId);
    if (!rec) return;
    const prev = this.mechSpecOf(t.objectId) ?? mechSpecFor(rec.state.assetId);
    const parts = { ...prev.parts };
    const p = { ...parts[t.partId] };
    p.pos = [t.mesh.position.x, t.mesh.position.y, t.mesh.position.z];
    p.rot = [t.mesh.rotation.x, t.mesh.rotation.y, t.mesh.rotation.z];
    p.scale = [t.mesh.scale.x, t.mesh.scale.y, t.mesh.scale.z];
    parts[t.partId] = p;
    const spec: MechSpec = { ...prev, parts };
    rec.state = { ...rec.state, mechSpec: spec };
  }

  /** Скульптинг кистью по точке мировых координат (щёлкнул по меху в сцене).
   *  Результат кладём в спецификацию, иначе следующая пересборка рига его съест. */
  sculptMech(objectId: string, world: THREE.Vector3, brush: BrushSettings, mode: BrushMode): number {
    const rec = this.objects.get(objectId);
    if (!rec) return 0;
    let hits = 0;
    rec.group.updateMatrixWorld(true);
    rec.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      hits += sculptMesh(m, world, brush, mode);
    });
    if (!hits) return 0;
    const prev = rec.state.mechSpec ?? defaultMechSpec();
    const parts = { ...prev.parts };
    let dirty = false;
    rec.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const id = m.userData.partId as PartId | undefined;
      if (!id || !parts[id]) return;
      const d = captureSculptDeltas(m);
      parts[id] = { ...parts[id], sculpt: d };
      dirty = true;
    });
    if (dirty) {
      const spec: MechSpec = { ...prev, parts };
      rec.state = { ...rec.state, mechSpec: spec };
      this.rebuildMech(objectId, spec);
      this.pushHistory();
    }
    return hits;
  }

  /** Луч в сцену по экранным координатам: первый объект под курсором. */
  pickAt(clientX: number, clientY: number): { objectId: string; point: THREE.Vector3 } | null {
    const dom = this.renderer.domElement;
    const r = dom.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.objectsList(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.objectId) o = o.parent;
      const id = o?.userData.objectId as string | undefined;
      if (id && this.objects.has(id)) return { objectId: id, point: h.point.clone() };
    }
    return null;
  }

  private objectsList(): THREE.Object3D[] {
    return Array.from(this.objects.values()).map((o) => o.group);
  }

  /** Сбросить скульптинг меха к исходной форме. */
  resetMechSculpt(objectId: string): boolean {
    const rec = this.objects.get(objectId);
    if (!rec) return false;
    const prev = rec.state.mechSpec ?? defaultMechSpec();
    const parts = { ...prev.parts };
    let any = false;
    for (const id of Object.keys(parts) as PartId[]) {
      if (parts[id].sculpt) {
        parts[id] = { ...parts[id], sculpt: undefined };
        any = true;
      }
    }
    if (!any) return false;
    const spec: MechSpec = { ...prev, parts };
    rec.state = { ...rec.state, mechSpec: spec };
    this.rebuildMech(objectId, spec);
    this.pushHistory();
    return true;
  }

  // ---------------- infinite ground tile (world mode) ----------------
  private worldGround: THREE.Mesh | null = null;

  private buildWorldGround(): void {
    if (this.worldGround) return;
    // 60 сегментов вместо 90: рельеф плавный, а геометрии и нормалей
    // на старте превью генерировать заметно меньше
    const geo = new THREE.PlaneGeometry(360, 360, 60, 60);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.groundHeight(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.groundMat);
    mesh.receiveShadow = true;
    mesh.name = '__world_ground__';
    this.worldGround = mesh;
    this.scene.add(mesh);
    this.ground.visible = false;
  }

  updateWorldGround(px: number, pz: number): void {
    if (!this.worldGround) return;
    const STEP = 30; // период текстуры (repeat 8 на 240м исходного грунта)
    const gx = Math.round(px / STEP) * STEP;
    const gz = Math.round(pz / STEP) * STEP;
    const mesh = this.worldGround;
    if (mesh.position.x === gx && mesh.position.z === gz) return;
    mesh.position.set(gx, 0, gz);
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.groundHeight(pos.getX(i) + gx, pos.getZ(i) + gz));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  private removeWorldGround(): void {
    if (!this.worldGround) return;
    this.ground.visible = true;
    this.scene.remove(this.worldGround);
    (this.worldGround.geometry as THREE.BufferGeometry).dispose();
    this.worldGround = null;
  }

  /**
   * Лёгкое восстановление после превью.
   * Полный restore() удаляет и заново создаёт все объекты — это сборка геометрии
   * заново (фриз 200-300 мс). Здесь мы только возвращаем трансформы и видимость
   * на месте: объекты те же, пересоздавать их не нужно.
   */
  private restoreAfterPlay(json: string) {
    let data: { objects?: SceneObjectState[] };
    try { data = JSON.parse(json); } catch { return; }
    const wanted = (data.objects ?? []) as SceneObjectState[];
    const keep = new Set(wanted.map((o) => o.id));
    // появившиеся во время превью — убираем
    Array.from(this.objects.keys()).forEach((id) => { if (!keep.has(id)) this.removeObjectInternal(id); });
    wanted.forEach((s) => {
      const rec = this.objects.get(s.id);
      if (!rec) { this.spawnFromState(s); return; }
      rec.state = { ...s };
      const g = rec.group;
      g.position.set(...s.position);
      g.rotation.set(
        THREE.MathUtils.degToRad(s.rotation[0]),
        THREE.MathUtils.degToRad(s.rotation[1]),
        THREE.MathUtils.degToRad(s.rotation[2]),
      );
      g.scale.set(...s.scale);
      g.visible = s.visible;
      this.applyStateMaterials(g, s);
    });
    this.emitObjects();
  }

  stopPlay() {
    if (!this.play) return;
    this.play.dispose();
    this.play = null;
    this.removeWorldGround();
    if (this.spawnedMech) {
      this.scene.remove(this.spawnedMech);
      this.spawnedMech.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((x) => { if (x) x.dispose(); });
          if (m.geometry) m.geometry.dispose();
        }
      });
      this.spawnedMech = null;
    }
    this.restoreAfterPlay(this.playSnapshot);
    if (this.savedCam) {
      this.camera.position.copy(this.savedCam.pos);
      this.orbit.target.copy(this.savedCam.target);
      this.camera.fov = this.savedCam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.orbit.enabled = true;
    this.transform.enabled = true;
    this.applyEnv();
  }

  // ---------------- pointer ----------------
  private setPointer(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  // ---------------- рамка выделения (Ctrl + протяжка) ----------------
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private marqueeEl: HTMLDivElement | null = null;

  private startMarquee(e: PointerEvent) {
    this.marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    if (!this.marqueeEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;border:1px dashed #ffa33c;background:rgba(255,154,60,0.12);pointer-events:none;z-index:5;display:none';
      this.container.appendChild(el);
      this.marqueeEl = el;
    }
    this.marqueeEl.style.display = 'block';
    this.updateMarquee();
    this.orbit.enabled = false; // камеру не крутим, пока тянем рамку
  }

  private updateMarquee() {
    if (!this.marquee || !this.marqueeEl) return;
    const r = this.container.getBoundingClientRect();
    const x = Math.min(this.marquee.x0, this.marquee.x1) - r.left;
    const y = Math.min(this.marquee.y0, this.marquee.y1) - r.top;
    const w = Math.abs(this.marquee.x1 - this.marquee.x0);
    const h = Math.abs(this.marquee.y1 - this.marquee.y0);
    this.marqueeEl.style.left = `${x}px`;
    this.marqueeEl.style.top = `${y}px`;
    this.marqueeEl.style.width = `${w}px`;
    this.marqueeEl.style.height = `${h}px`;
  }

  private endMarquee() {
    const m = this.marquee;
    this.marquee = null;
    if (this.marqueeEl) this.marqueeEl.style.display = 'none';
    this.orbit.enabled = true;
    if (!m) return;
    const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
    const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    if (x1 - x0 < 4 && y1 - y0 < 4) return; // просто клик — обработает onPointerUp
    const ids = this.objectsInRect(x0, y0, x1, y1);
    this.setSelection(ids);
    if (ids.length) this.cb.onStats({ fps: this.fps, tris: 0, calls: 0, objects: this.objects.size });
  }

  /** Объекты, чей экранный bounding box пересекает прямоугольник. */
  private objectsInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const out: string[] = [];
    this.objects.forEach(({ group, state }) => {
      if (!state.visible || state.locked) return;
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let behind = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        v.project(this.camera);
        if (v.z > 1) { behind = true; break; }
        const sx = (v.x * 0.5 + 0.5) * r.width + r.left;
        const sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      if (behind) return;
      if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) return;
      out.push(state.id);
    });
    return out;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.downPos = { x: e.clientX, y: e.clientY };
    // Ctrl + ЛКМ + протяжка — рамка выделения
    if (this.play || e.button !== 0 || !e.ctrlKey || this.dragging) return;
    if (this.transform.axis) return; // попали в гизмо — рамку не начинаем
    this.startMarquee(e);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.play) return;
    if (this.marquee) {
      this.marquee.x1 = e.clientX;
      this.marquee.y1 = e.clientY;
      this.updateMarquee();
      return;
    }
    this.setPointer(e);
    if (this.ghost && this.ghostAssetId) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.ground, false)[0];
      if (hit) {
        let x = hit.point.x, z = hit.point.z;
        if (this.env.snap) { x = Math.round(x / this.env.snapSize) * this.env.snapSize; z = Math.round(z / this.env.snapSize) * this.env.snapSize; }
        this.ghost.position.set(x, this.groundHeight(x, z) + this.ghostYOffset, z);
        // В бесконечном мире ставить можно куда угодно, в конечной сцене — только на площадку
        const placeLimit = this.world.enabled !== false ? 50000 : 110;
        this.ghostValid = Math.abs(x) < placeLimit && Math.abs(z) < placeLimit;
        this.ghost.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) (mesh.material as THREE.MeshBasicMaterial).color.set(this.ghostValid ? 0x54ff9a : 0xff4444);
        });
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.play) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    // рамка выделения закончилась
    if (this.marquee) {
      this.endMarquee();
      if (moved > 4) return;
    }
    if (this.dragging) return;
    // placement click
    if (this.ghost && this.ghostAssetId && moved < 6 && e.button === 0) {
      if (this.ghostValid) {
        const id = this.addAsset(this.ghostAssetId, this.ghost.position.clone());
        if (!e.shiftKey) { this.cancelPlacement(); }
        else { this.select(id); /* keep placing */ }
      }
      return;
    }
    if (moved > 6) return; // was orbit drag
    if (e.button !== 0) return;
    // select
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = Array.from(this.objects.values()).filter((o) => o.state.visible).map((o) => o.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length) {
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !obj.userData.objectId) obj = obj.parent;
      const id = obj ? (obj.userData.objectId as string) : null;
      // Ctrl — добавить к выделению, Shift — заменить выделение
      this.select(id, e.ctrlKey);
    } else {
      this.select(null, e.ctrlKey);
    }
  };

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.postfx) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.postfx.setSize(s.x, s.y);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.play) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { this.cancelPlacement(); this.select(null); }
    if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelected(); }
    if (e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 'ц') this.setTransformMode('translate');
    if (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 'у') this.setTransformMode('rotate');
    if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'к') this.setTransformMode('scale');
    if (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'а') this.focusSelected();
    if (e.key.toLowerCase() === 'g') this.dropToGround();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); }
  };

  /** Тип, задающий мех игрока: сначала объект стартового меха, иначе тип с ролью player. */
  playerTypeId(): string | undefined {
    if (this.mechConfig.playerObjectId && this.mechConfig.playerObjectId !== 'auto' && this.mechConfig.playerObjectId !== 'new') {
      const obj = this.objects.get(this.mechConfig.playerObjectId);
      if (obj?.state.typeId) return obj.state.typeId;
    }
    if (this.mechConfig.playerObjectId === 'new') {
      const anyMech = Array.from(this.objects.values()).find((o) => o.state.assetId.startsWith('mech_') && o.state.role !== 'enemy');
      if (anyMech?.state.typeId) return anyMech.state.typeId;
    }
    return findByRole(this.project.types, 'player')?.id;
  }

  // ---------------- object types (project v2) ----------------
  getTypes(): ObjectType[] {
    return this.project.types;
  }

  getType(id: string | undefined): ObjectType | undefined {
    return id ? this.project.types.find((t) => t.id === id) : undefined;
  }

  /** Тип по умолчанию для категории ассета — чтобы новые объекты сразу попадали в тип. */
  defaultTypeIdFor(assetId: string): string | undefined {
    const mech = assetId.startsWith('mech_');
    const category = mech ? 'mech' : assetId === 'turret' ? 'turret' : 'prop';
    const byAsset = this.project.types.find((t) => t.assetId === assetId && t.role !== 'player');
    if (byAsset) return byAsset.id;
    return findByCategory(this.project.types, category)?.id;
  }

  createType(partial: Partial<ObjectType> & { name: string }): ObjectType {
    const id = partial.id ?? nextId('type');
    const type = makeType({ ...partial, id, name: partial.name });
    type.parentTypeId = wouldCycle(this.project.types, id, type.parentTypeId) ? undefined : type.parentTypeId;
    this.project = { ...this.project, types: [...this.project.types, type] };
    this.typeDirty = true;
    return type;
  }

  updateType(id: string, patch: Partial<ObjectType>): boolean {
    const idx = this.project.types.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    const draft = { ...this.project.types[idx], ...patch, id };
    if (patch.parentTypeId !== undefined && wouldCycle(this.project.types, id, patch.parentTypeId)) draft.parentTypeId = undefined;
    const next = [...this.project.types];
    next[idx] = normalizeType(draft, next);
    this.project = { ...this.project, types: next };
    this.typeDirty = true;
    return true;
  }

  updateBehavior(typeId: string, behaviorId: string, patch: { enabled?: boolean; settings?: PropValues }): boolean {
    const idx = this.project.types.findIndex((t) => t.id === typeId);
    if (idx < 0) return false;
    const type = this.project.types[idx];
    const bi = type.behaviors.findIndex((b) => b.id === behaviorId);
    const behaviors = [...type.behaviors];
    if (bi < 0) return false;
    behaviors[bi] = {
      id: behaviors[bi].id,
      enabled: patch.enabled ?? behaviors[bi].enabled,
      settings: patch.settings ? { ...behaviors[bi].settings, ...patch.settings } : behaviors[bi].settings,
    };
    const next = [...this.project.types];
    next[idx] = normalizeType({ ...type, behaviors }, next);
    this.project = { ...this.project, types: next };
    this.typeDirty = true;
    return true;
  }

  /**
   * Обратная синхронизация: настройки из панели «Мех» пишутся в поведения типа игрока.
   * Без этого превью всегда брало значения из типа, и правки панели «Мех» выглядели
   * как «нигде не применяются». Теперь обе панели редактируют одно и то же.
   */
  saveMechConfigToType(): boolean {
    const type = findByRole(this.project.types, 'player');
    if (!type) return false;
    const c = this.mechConfig;
    const put = (behaviorId: string, settings: Record<string, PropValue>) => {
      if (!type.behaviors.some((b) => b.id === behaviorId)) return;
      this.updateBehavior(type.id, behaviorId, { settings: settings as PropValues });
    };
    put('movement', {
      maxSpeed: c.maxSpeed, turnSpeed: c.turnSpeed, torsoTwist: c.torsoTwist,
      accel: c.accel, jumpJets: c.jumpJets,
    });
    put('camera', {
      defaultView: c.defaultView, sensitivity: c.sensitivity, invertY: c.invertY,
      cameraNeedsMMB: c.cameraNeedsMMB,
      cockpitFov: c.cockpit.fov, cockpitHeight: c.cockpit.height, cockpitForward: c.cockpit.forward,
      cockpitSway: c.cockpit.sway, pitchLimit: c.cockpit.pitchLimit,
      thirdDistance: c.third.distance, thirdHeight: c.third.height, thirdFov: c.third.fov,
      thirdSmoothing: c.third.smoothing, thirdAutoFollow: c.third.autoFollow,
      shoulderDistance: c.shoulder.distance, shoulderHeight: c.shoulder.height,
      shoulderSide: c.shoulder.side, shoulderFov: c.shoulder.fov,
      tacticalDistance: c.tactical.distance, tacticalPitch: c.tactical.pitch,
      tacticalFov: c.tactical.fov, tacticalAutoFollow: c.tactical.autoFollow,
    });
    put('cockpit', { hudColor: c.hudColor });
    put('weapons', { slot1: c.weapons[0], slot2: c.weapons[1], slot3: c.weapons[2], slot4: c.weapons[3] });
    // настройки записаны в тип — незакоммиченных изменений не осталось
    this.typeDirty = false;
    this.emitObjects();
    return true;
  }

  duplicateType(id: string): ObjectType | null {
    const src = this.project.types.find((t) => t.id === id);
    if (!src) return null;
    const copy: ObjectType = {
      ...src,
      id: nextId('type'),
      name: `${src.name} (копия)`,
      props: { ...src.props },
      behaviors: src.behaviors.map((b) => ({ id: b.id, enabled: b.enabled, settings: { ...b.settings } })),
    };
    this.project = { ...this.project, types: [...this.project.types, copy] };
    this.typeDirty = true;
    return copy;
  }

  deleteType(id: string): boolean {
    if (this.project.types.length <= 1) return false;
    const used = Array.from(this.objects.values()).some((o) => o.state.typeId === id);
    if (used) return false;
    const parentless = this.project.types.filter((t) => t.parentTypeId === id).map((t) => ({ ...t, parentTypeId: undefined }));
    const types = this.project.types.filter((t) => t.id !== id).map((t) => parentless.find((p) => p.id === t.id) ?? t);
    this.project = { ...this.project, types };
    this.typeDirty = true;
    return true;
  }

  /** Привязать тип к объекту сцены и синхронизировать роль. */
  assignType(objectId: string, typeId: string): boolean {
    const obj = this.objects.get(objectId);
    const type = this.project.types.find((t) => t.id === typeId);
    if (!obj || !type) return false;
    const role: Role = type.role;
    const patch: Partial<SceneObjectState> = { typeId };
    if (role === 'enemy') patch.role = 'enemy';
    else if (role === 'reserve') patch.role = 'spawn';
    else if (role === 'player') patch.role = 'spawn';
    else if (obj.state.role === 'enemy' || obj.state.role === 'spawn') patch.role = 'prop';
    this.updateObject(objectId, patch, true);
    return true;
  }

  /** Настройки типа меха игрока → живой MechConfig. Мост между типами и превью. */
  applyPlayerType(): boolean {
    const type = findByRole(this.project.types, 'player');
    if (!type) return false;
    const resolved = resolveType(type.id, this.project.types);
    if (!resolved) return false;
    const val = (bid: string, key: string, fb?: unknown) => {
      const b = resolved.behaviors.find((x) => x.id === bid);
      if (!b || !b.enabled) return undefined;
      const v = b.settings[key];
      return v === undefined ? fb : v;
    };
    const next = mergeMechConfig({
      ...this.mechConfig,
      chassis: (type.props.chassis as string) || this.mechConfig.chassis,
      defaultView: (val('camera', 'defaultView') as MechConfig['defaultView']) ?? this.mechConfig.defaultView,
      sensitivity: (val('camera', 'sensitivity') as number) ?? this.mechConfig.sensitivity,
      invertY: (val('camera', 'invertY') as boolean) ?? this.mechConfig.invertY,
      cameraNeedsMMB: (val('camera', 'cameraNeedsMMB') as boolean) ?? this.mechConfig.cameraNeedsMMB,
      cockpit: {
        ...this.mechConfig.cockpit,
        fov: (val('camera', 'cockpitFov') as number) ?? this.mechConfig.cockpit.fov,
        height: (val('camera', 'cockpitHeight') as number) ?? this.mechConfig.cockpit.height,
        forward: (val('camera', 'cockpitForward') as number) ?? this.mechConfig.cockpit.forward,
        sway: (val('camera', 'cockpitSway') as number) ?? this.mechConfig.cockpit.sway,
        pitchLimit: (val('camera', 'pitchLimit') as number) ?? this.mechConfig.cockpit.pitchLimit,
      },
      third: {
        ...this.mechConfig.third,
        distance: (val('camera', 'thirdDistance') as number) ?? this.mechConfig.third.distance,
        height: (val('camera', 'thirdHeight') as number) ?? this.mechConfig.third.height,
        fov: (val('camera', 'thirdFov') as number) ?? this.mechConfig.third.fov,
        smoothing: (val('camera', 'thirdSmoothing') as number) ?? this.mechConfig.third.smoothing,
        autoFollow: (val('camera', 'thirdAutoFollow') as boolean) ?? this.mechConfig.third.autoFollow,
      },
      shoulder: {
        ...this.mechConfig.shoulder,
        distance: (val('camera', 'shoulderDistance') as number) ?? this.mechConfig.shoulder.distance,
        height: (val('camera', 'shoulderHeight') as number) ?? this.mechConfig.shoulder.height,
        side: (val('camera', 'shoulderSide') as number) ?? this.mechConfig.shoulder.side,
        fov: (val('camera', 'shoulderFov') as number) ?? this.mechConfig.shoulder.fov,
      },
      tactical: {
        ...this.mechConfig.tactical,
        distance: (val('camera', 'tacticalDistance') as number) ?? this.mechConfig.tactical.distance,
        pitch: (val('camera', 'tacticalPitch') as number) ?? this.mechConfig.tactical.pitch,
        fov: (val('camera', 'tacticalFov') as number) ?? this.mechConfig.tactical.fov,
        autoFollow: (val('camera', 'tacticalAutoFollow') as boolean) ?? this.mechConfig.tactical.autoFollow,
      },
      hudColor: (val('cockpit', 'hudColor') as string) ?? this.mechConfig.hudColor,
      maxSpeed: (val('movement', 'maxSpeed') as number) ?? this.mechConfig.maxSpeed,
      turnSpeed: (val('movement', 'turnSpeed') as number) ?? this.mechConfig.turnSpeed,
      torsoTwist: (val('movement', 'torsoTwist') as number) ?? this.mechConfig.torsoTwist,
      accel: (val('movement', 'accel') as number) ?? this.mechConfig.accel,
      jumpJets: (val('movement', 'jumpJets') as boolean) ?? this.mechConfig.jumpJets,
      weapons: [
        (val('weapons', 'slot1') as WeaponId) ?? this.mechConfig.weapons[0],
        (val('weapons', 'slot2') as WeaponId) ?? this.mechConfig.weapons[1],
        (val('weapons', 'slot3') as WeaponId) ?? this.mechConfig.weapons[2],
        (val('weapons', 'slot4') as WeaponId) ?? this.mechConfig.weapons[3],
      ].filter((w) => w && w !== 'none') as WeaponId[],
    });
    this.mechConfig = next;
    this.project = { ...this.project, player: next };
    this.typeDirty = false;
    return true;
  }

  hasPendingTypeChanges(): boolean {
    return this.typeDirty;
  }

  private syncSceneTypes() {
    const scene = Array.from(this.objects.values()).map((o) => ({
      id: o.state.id,
      typeId: o.state.typeId,
      role: (this.project.types.find((t) => t.id === o.state.typeId)?.role ?? 'neutral') as Role,
      name: o.state.name,
    }));
    this.project = { ...this.project, scene };
  }

  private buildProject(): ProjectV2 {
    this.syncSceneTypes();
    return {
      ...this.project,
      environment: this.env,
      world: this.world,
      player: this.mechConfig,
      scenario: this.scenario,
    };
  }

  private applyProject(p: ProjectV2) {
    this.project = p;
    if (p.environment && typeof p.environment === 'object') this.env = { ...this.env, ...(p.environment as Partial<EnvState>) };
    if (p.world && typeof p.world === 'object') this.world = this.clampWorld({ ...DEFAULT_WORLD_CONFIG, ...(p.world as WorldConfig) }, DEFAULT_WORLD_CONFIG);
    if (p.player && typeof p.player === 'object') this.mechConfig = mergeMechConfig(p.player as Partial<MechConfig>);
    if (p.scenario && typeof p.scenario === 'object') {
      const base = JSON.parse(JSON.stringify(DEFAULT_SCENARIO)) as Scenario;
      this.scenario = { ...base, ...(p.scenario as Scenario) };
      if (!Array.isArray(this.scenario.waves)) this.scenario.waves = base.waves;
    }
    const byId = new Map(p.scene.map((s) => [s.id, s]));
    for (const { state } of this.objects.values()) {
      const entry = byId.get(state.id);
      if (entry?.typeId) {
        state.typeId = entry.typeId;
        // роль объекта НЕ трогаем: её выбирает пользователь («Мех игрока» и т.д.).
        // Роль ТИПА может только уточнить «враг».
        const typeRole = this.project.types.find((t) => t.id === entry.typeId)?.role;
        if (typeRole === 'enemy' && state.role !== 'player') state.role = 'enemy';
      }
    }
    this.applyEnv();
  }

  // ---------------- event sheets (project v2) ----------------
  getSheets(): EventSheet[] {
    return this.project.sheets;
  }

  getSheet(id: string): EventSheet | undefined {
    return this.project.sheets.find((s) => s.id === id);
  }

  private patchSheet(sheetId: string, fn: (sheet: EventSheet) => EventSheet): boolean {
    const idx = this.project.sheets.findIndex((s) => s.id === sheetId);
    if (idx < 0) return false;
    const next = [...this.project.sheets];
    next[idx] = fn(this.project.sheets[idx]);
    this.project = { ...this.project, sheets: next };
    this.typeDirty = true;
    return true;
  }

  createSheet(name: string, event = 'on_spawn'): EventSheet {
    const sheet: EventSheet = { id: nextId('sheet'), name, rows: [newRow(event)] };
    this.project = { ...this.project, sheets: [...this.project.sheets, sheet] };
    this.typeDirty = true;
    return sheet;
  }

  renameSheet(sheetId: string, name: string): boolean {
    return this.patchSheet(sheetId, (s) => ({ ...s, name }));
  }

  deleteSheet(sheetId: string): boolean {
    if (this.project.sheets.length <= 1) return false;
    this.project = { ...this.project, sheets: this.project.sheets.filter((s) => s.id !== sheetId) };
    this.typeDirty = true;
    return true;
  }

  addRow(sheetId: string, event: string, parentRowId?: string): boolean {
    return this.patchSheet(sheetId, (s) => {
      const row = newRow(event);
      if (!parentRowId) return { ...s, rows: [...s.rows, row] };
      return { ...s, rows: updateRowIn(s.rows, parentRowId, { children: [...(findRow(s.rows, parentRowId)?.children ?? []), row] }) };
    });
  }

  updateRow(sheetId: string, rowId: string, patch: Partial<EventRow>): boolean {
    return this.patchSheet(sheetId, (s) => ({ ...s, rows: updateRowIn(s.rows, rowId, patch) }));
  }

  deleteRow(sheetId: string, rowId: string): boolean {
    return this.patchSheet(sheetId, (s) => ({ ...s, rows: removeRowFrom(s.rows, rowId) }));
  }

  moveRowUp(sheetId: string, rowId: string): boolean {
    return this.patchSheet(sheetId, (s) => ({ ...s, rows: moveRow(s.rows, rowId, -1) }));
  }

  moveRowDown(sheetId: string, rowId: string): boolean {
    return this.patchSheet(sheetId, (s) => ({ ...s, rows: moveRow(s.rows, rowId, 1) }));
  }

  setCondition(sheetId: string, rowId: string, condition: ConditionSpec | undefined): boolean {
    return this.patchSheet(sheetId, (s) => ({
      ...s,
      rows: updateRowIn(s.rows, rowId, condition ? { condition: normalizeCondition(condition) } : { condition: undefined }),
    }));
  }

  addAction(sheetId: string, rowId: string, action: ActionSpec, branch: 'then' | 'else' = 'then'): boolean {
    return this.patchSheet(sheetId, (s) => ({
      ...s,
      rows: updateRowIn(s.rows, rowId, { [branch]: [...(findRow(s.rows, rowId)?.[branch] ?? []), normalizeAction(action)] } as Partial<EventRow>),
    }));
  }

  updateAction(sheetId: string, rowId: string, actionIndex: number, patch: Partial<ActionSpec>, branch: 'then' | 'else' = 'then'): boolean {
    return this.patchSheet(sheetId, (s) => {
      const row = findRow(s.rows, rowId);
      if (!row) return s;
      const list = [...row[branch]];
      const cur = list[actionIndex];
      if (!cur) return s;
      list[actionIndex] = normalizeAction({ ...cur, ...patch });
      return { ...s, rows: updateRowIn(s.rows, rowId, { [branch]: list } as Partial<EventRow>) };
    });
  }

  deleteAction(sheetId: string, rowId: string, actionIndex: number, branch: 'then' | 'else' = 'then'): boolean {
    return this.patchSheet(sheetId, (s) => {
      const row = findRow(s.rows, rowId);
      if (!row) return s;
      const list = row[branch].filter((_, i) => i !== actionIndex);
      return { ...s, rows: updateRowIn(s.rows, rowId, { [branch]: list } as Partial<EventRow>) };
    });
  }

// ---------------- export / import ----------------
  /** Быстрый экспорт без аудиофайлов — для локального сохранения в браузере. */
  exportJSON(): string {
    return projectToJSON(this.buildProject(), Array.from(this.objects.values()).map((o) => o.state), new Date().toISOString(), []);
  }

  /** Полный экспорт: настройки + типы + листы + встроенные звуковые файлы. */
  async exportProjectJSON(): Promise<string> {
    const bound = new Set(this.env.soundBindings.map((b) => b.soundId));
    const ids = Array.from(new Set([...bound, ...audio.getAssets().map((a) => a.id)]));
    const sounds: ExportedSound[] = [];
    for (const id of ids) {
      const raw = await audio.rawBytes(id);
      if (!raw) continue;
      const asset = audio.getAssets().find((a) => a.id === id);
      sounds.push({ ...raw, duration: asset?.duration });
    }
    return projectToJSON(this.buildProject(), Array.from(this.objects.values()).map((o) => o.state), new Date().toISOString(), sounds);
  }

  /** Импорт: восстанавливает типы, листы, настройки и звуковые файлы из проекта. */
  async importProjectJSON(json: string): Promise<{ ok: boolean; sounds: number; message?: string }> {
    let data: unknown;
    try { data = JSON.parse(json); } catch { return { ok: false, sounds: 0, message: 'Некорректный JSON' }; }
    const project = ensureProject(data);
    let restored = 0;
    for (const s of project.sounds) {
      if (!s?.data) continue;
      if (await audio.importAsset(s.id, s.name ?? s.id, s.mime ?? 'audio/mpeg', s.data)) restored += 1;
    }
    const ok = this.importJSON(json);
    return ok
      ? { ok: true, sounds: restored }
      : { ok: false, sounds: restored, message: 'Сцена не загружена' };
  }

  importJSON(json: string): boolean {
    try {
      const data = JSON.parse(json);
      const objs = (data.objects || []) as SceneObjectState[];
      if (!Array.isArray(objs)) return false;
      if (this.play) return false;
      this.historyLock = true;
      try {
        const project = ensureProject(data);
        const savedTypes = project.types.map((t) => t.id);
        const objsWithTypes = objs.map((s) => ({
          ...s,
          typeId: s.typeId
            ?? project.scene.find((e) => e.id === s.id)?.typeId
            ?? (savedTypes.length ? this.defaultTypeIdFor(s.assetId) : undefined),
        }));
        this.applyProject(project);
        Array.from(this.objects.keys()).forEach((id) => this.removeObjectInternal(id));
        objsWithTypes.forEach((s) => {
          if (!getAsset(s.assetId)) return;
          // роли сохраняем ВСЕ: player / reserve / enemy / spawn / prop
          this.spawnFromState({ ...s, id: s.id || genId(), role: normObjectRole(s.role) });
        });
        // если в проекте есть мех с ролью «игрок» — выбор игрока должен совпадать
        const playerObj = objsWithTypes.find((s) => s.role === 'player' && s.assetId.startsWith('mech_'));
        if (playerObj) this.mechConfig = { ...this.mechConfig, playerObjectId: playerObj.id };
        this.select(null);
        this.emitObjects();
      } finally { this.historyLock = false; }
      this.history = []; this.historyIdx = -1;
      this.pushHistory();
      return true;
    } catch { return false; }
  }

  exportGLB(includeGround = true): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const exportScene = new THREE.Scene();
      this.objects.forEach(({ group }) => {
        if (!group.visible) return;
        const clone = group.clone(true);
        // GLTF doesn't support THREE.Sprite (glow billboards) — strip them
        const sprites: THREE.Object3D[] = [];
        clone.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o); });
        sprites.forEach((s) => s.parent?.remove(s));
        exportScene.add(clone);
      });
      if (includeGround) exportScene.add(this.ground.clone());
      const exporter = new GLTFExporter();
      exporter.parse(exportScene, (result) => {
        if (result instanceof ArrayBuffer) resolve(new Blob([result], { type: 'model/gltf-binary' }));
        else reject(new Error('GLB export failed'));
      }, (err) => reject(err), { binary: true, onlyVisible: true, animations: [] });
    });
  }

  /**
   * Экспорт одного объекта в GLB — редактируемый формат (Blender/Unity/Godot).
   * При withAnimation запекаем походный цикл прямо в файл: ключи на узлы
   * leg_L/leg_R/arm_L/arm_R/torso, поэтому в Blender сразу готовая анимация,
   * которую можно править кривыми или переразметить.
   */
  exportObjectGLB(objectId: string, withAnimation = true, seconds = 2): Promise<Blob> {
    const src = this.objects.get(objectId);
    if (!src) return Promise.reject(new Error('Объект не найден'));
    const scene = new THREE.Scene();
    const clone = src.group.clone(true);
    // уникальные имена узлов — иначе треки анимации привяжутся не туда
    const used = new Set<string>();
    clone.traverse((o) => {
      const base = o.name || o.type;
      let name = base;
      let i = 1;
      while (used.has(name)) name = `${base}_${i++}`;
      used.add(name);
      o.name = name;
    });
    // спрайты GLTF не поддерживает
    const sprites: THREE.Object3D[] = [];
    clone.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o); });
    sprites.forEach((s) => s.parent?.remove(s));
    scene.add(clone);

    const animations: THREE.AnimationClip[] = [];
    if (withAnimation) {
      const joints = new Map<string, THREE.Object3D>();
      clone.traverse((o) => {
        if (o.name.startsWith('leg_') || o.name.startsWith('arm_') || o.name === 'torso') joints.set(o.name, o);
      });
      if (joints.size) {
        const fps = 30;
        const frames = Math.max(2, Math.round(fps * seconds));
        const times = new Float32Array(frames);
        for (let f = 0; f < frames; f++) times[f] = f / fps;
        const tracks: THREE.KeyframeTrack[] = [];
        const track = (node: THREE.Object3D, fn: (phase: number) => number) => {
          const values = new Float32Array(frames * 4);
          const q = new THREE.Quaternion();
          const e = new THREE.Euler();
          for (let f = 0; f < frames; f++) {
            const phase = (f / frames) * Math.PI * 2;
            e.set(fn(phase), 0, 0);
            q.setFromEuler(e);
            q.toArray(values, f * 4);
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
        };
        for (const [name, node] of joints) {
          if (name === 'torso') track(node, (p) => Math.sin(p) * 0.03);
          else if (name.startsWith('leg_')) track(node, (p) => (name.endsWith('_L') ? Math.sin(p) : -Math.sin(p)) * 0.5);
          else track(node, (p) => (name.endsWith('_L') ? -Math.sin(p) : Math.sin(p)) * 0.35);
        }
        animations.push(new THREE.AnimationClip(`${clone.name}_walk`, seconds, tracks));
      }
    }

    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(scene, (result) => {
        if (result instanceof ArrayBuffer) resolve(new Blob([result], { type: 'model/gltf-binary' }));
        else reject(new Error('GLB export failed'));
      }, (err) => reject(err), { binary: true, onlyVisible: true, animations });
    });
  }

  screenshot(width = 1920): string {
    // temporarily resize for hi-res
    const prevPR = this.renderer.getPixelRatio();
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const aspect = cw / ch;
    const h = Math.round(width / aspect);
    this.renderer.setSize(width, h, false);
    this.renderer.setPixelRatio(1);
    this.camera.aspect = width / h;
    this.camera.updateProjectionMatrix();
    // hide helpers
    const gridVis = this.grid.visible;
    this.grid.visible = false;
    if (this.collisionDebug) this.collisionDebug.lines.visible = false;
    if (this.boxHelper) this.boxHelper.visible = false;
    if (this.transformHelper) this.transformHelper.visible = false;
    else (this.transform as unknown as THREE.Object3D).visible = false;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    // restore
    this.grid.visible = gridVis;
    if (this.collisionDebug) this.collisionDebug.lines.visible = true;
    if (this.boxHelper) this.boxHelper.visible = true;
    if (this.transformHelper) this.transformHelper.visible = true;
    else (this.transform as unknown as THREE.Object3D).visible = true;
    this.renderer.setSize(cw, ch, false);
    this.renderer.setPixelRatio(prevPR);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.onResize();
    return url;
  }

  loadDemoScene() {
    this.historyLock = true;
    try {
      Array.from(this.objects.keys()).forEach((id) => this.removeObjectInternal(id));
      // уровень 1: мех игрока, вражеская база, зона зачистки
      this.world = this.clampWorld({
        ...this.world,
        zones: [
          { id: 'zone_1', name: 'База «Шершень»', x: 12, z: 10, r: 110 },
        ],
      }, this.world);
      const place = (assetId: string, x: number, z: number, ry = 0, extra: Partial<SceneObjectState> = {}) => {
        const def = getAsset(assetId)!;
        const id = genId();
        const y = this.groundHeight(x, z);
        const s: SceneObjectState = {
          id, assetId, name: def.name, position: [x, y, z], rotation: [0, ry, 0], scale: [1, 1, 1],
          visible: true, locked: false, role: 'prop', tint: '#ffffff', rust: 0.35, metalness: 0.5, roughness: 0.75, emissive: 1.0, ...extra,
        };
        this.spawnFromState(s);
        this.dropGroupToGround(id);
      };
      // игрок
      place('mech_scout', 0, 0, 0, { role: 'player', name: '«Ястреб» (игрок)' });
      // вражеская база
      place('mech_molot', 12, 10, -40, { role: 'enemy', name: '«Молот» (враг)' });
      place('mech_scout', 15, 14, 20, { role: 'enemy', name: '«Ястреб» (враг)' });
      place('mech_juggernaut', -9, -7, 130, { role: 'enemy', name: '«Титан» (враг)' });
      place('turret', 5, 8.5, -140, { role: 'enemy', name: 'Турель «Шершень» (враг)' });
      place('turret', 18, 12, -20, { role: 'enemy', name: 'Турель «Шершень-2» (враг)' });
      // укрепления и пропы
      place('outpost', 9, 6, -25);
      place('bunker_wall', -2, 9, 0);
      place('bunker_wall', 3.2, 9, 0);
      place('sandbags', 0.5, 5.5, 10);
      place('barrel_group', -5, 3, 30);
      place('barrel', -6.5, 4.2, 0);
      place('barrel_toxic', 6.5, -4, 0);
      place('container', -12, 5, 75);
      place('rails', 12, -8, 90);
      place('girder', 4, -9, 40);
      place('scrap', -4, -11, 0);
      place('barrier', 8, 1, -35);
      place('barrier_broken', -8, -1, 60);
      place('slab', 1, 13, 15);
      place('watchtower', -14, -13, 20);
      place('generator', 11.5, 3.5, -90);
      place('antenna', 14, 11, 0);
      place('lamp', -1, -5, 0);
      place('dome', -11, 10, 0);
      place('checkpoint', 16, -1, -90);
      place('car_wreck', -18, 2, 115);
      place('rock', 20, 14, 0);
      place('dead_tree', -20, -5, 0);
      place('tires', 3, 3, 0);
      place('crate', 7.5, 5.5, 25);
      this.select(null);
      this.emitObjects();
    } finally { this.historyLock = false; }
    this.history = []; this.historyIdx = -1;
    this.pushHistory();
  }

  // ---------------- loop ----------------
  private lastFrameStamp = 0;
  /** последняя синхронизация миникарты (мс) */
  private lastMapSync = 0;
  /** разбор кадра по фазам, мс — для профайлера */
  private phaseTimes: Record<string, number> = {};
  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    const nowMs = performance.now();
    // сырое время кадра: dt зажат на 0.05 и потери в нём не видно
    const rawMs = this.lastFrameStamp ? nowMs - this.lastFrameStamp : 16.7;
    this.lastFrameStamp = nowMs;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // dust drift
    if (this.dustPoints?.visible) {
      const pos = this.dustPoints.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const wind = 2 + this.env.dust * 9;
      for (let i = 0; i < pos.count; i++) {
        const sp = this.dustData[i * 4];
        arr[i * 3] += (wind * sp * 0.35 + Math.sin(t * 0.7 + this.dustData[i * 4 + 1]) * this.dustData[i * 4 + 2] * 0.4) * dt;
        arr[i * 3 + 1] += Math.cos(t * 0.5 + this.dustData[i * 4 + 1]) * dt * 0.6;
        arr[i * 3 + 2] += wind * 0.22 * sp * dt;
        if (arr[i * 3] > 80) arr[i * 3] = -80;
        if (arr[i * 3 + 2] > 80) arr[i * 3 + 2] = -80;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 22;
        if (arr[i * 3 + 1] > 24) arr[i * 3 + 1] = 0.5;
      }
      pos.needsUpdate = true;
    }
    // миксеры анимаций — крутятся и в редакторе, и в игровом режиме
    this.animMixers.forEach((entry, id) => {
      const rec = this.objects.get(id);
      if (!rec) return;
      entry.mixer.update(dt);
      if (!this.animLoop && entry.action.time >= entry.clip.duration) {
        entry.action.time = 0;
        entry.action.paused = true;
      }
    });
    if (this.play) {
      // ----- PLAY MODE -----
      audio.updateListener(this.camera);
      const tPlay = performance.now();
      this.play.update(dt);
      this.phaseTimes.play = performance.now() - tPlay;
      this.applyPlayAnimation();
      // позиция меха игрока в состоянии объекта — чтобы миникарта и списки были живыми
      const own = this.play.currentMechId ? this.objects.get(this.play.currentMechId) : null;
      if (own) {
        const p = own.group.position;
        if (Math.abs(own.state.position[0] - p.x) > 0.05 || Math.abs(own.state.position[2] - p.z) > 0.05) {
          own.state.position = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
          // карту обновляем 10 раз в секунду — чаще бессмысленно и дорого
          if (nowMs - this.lastMapSync > 100) { this.lastMapSync = nowMs; this.emitObjects(); }
        }
      }
      const visionMode = this.play.vision === 'night' ? 1 : this.play.vision === 'thermal' ? 2 : 0;
      const usePost = this.env.fx?.postfx !== false;
      const tRender = performance.now();
      if (visionMode > 0 && usePost) {
        if (!this.postfx) {
          const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
          this.postfx = new PostFX(s.x, s.y);
        }
        this.postfx.render(this.renderer, this.scene, this.camera, visionMode, t);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this.phaseTimes.render = performance.now() - tRender;
    } else {
      // idle mech sway (skipped for selected/dragged object to avoid gizmo fighting)
      if (!this.dragging) {
        this.objects.forEach(({ group, state }) => {
          if (state.assetId.startsWith('mech_') && state.id !== this.selectedId) {
            group.position.y = state.position[1] + Math.sin(t * 1.2 + group.position.x) * 0.02;
            // анимация покоя: машина в простое «гудит», а не стоит мёртво.
            // Сила — из настроек этого меха (у каждого свои).
            const sway = state.anim?.idle ?? 1;
            if (sway > 0) applyIdleSway(group, { amount: sway, time: t + group.position.x * 0.3 });
          }
        });
      }
      // миксеры анимаций крутятся выше — и в редакторе, и в игре
      if (this.dragging && this.env.showCollisions) {
        this.debugT += dt;
        if (this.debugT >= 0.08) { this.debugT = 0; this.syncCollisionDebug(); }
      }
      audio.updateListener(this.camera);
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    }

    // ---------------- профайлер ----------------
    if (perf.enabled) {
      const ps = this.play?.perfStats();
      perf.sample(rawMs, {
        mode: this.play ? 'play' : 'edit',
        view: ps?.view ?? '-',
        calls: this.renderer.info.render.calls,
        tris: this.renderer.info.render.triangles,
        objects: this.objects.size,
        enemies: ps?.enemies ?? 0,
        proj: ps?.proj ?? 0,
        eproj: ps?.eproj ?? 0,
        parts: ps?.parts ?? 0,
        props: ps?.props ?? 0,
        decals: ps?.decals ?? 0,
        x: ps?.x ?? 0,
        z: ps?.z ?? 0,
        shadows: this.env.fx?.shadows ? 1 : 0,
        postfx: this.postfx ? 1 : 0,
        fog: this.env.fx?.fog ? 1 : 0,
        dust: this.env.fx?.dust ? 1 : 0,
        heat: ps?.heat ?? 0,
        waves: ps?.waves ?? 0,
        enemiesLeft: ps?.enemiesLeft ?? 0,
        flags: 0,
        // копия: ссылка сериализовалась бы только при отправке (через секунду)
        ph: this.phaseTimes ? { ...this.phaseTimes } : undefined,
      });
    }

    // fps
    this.frames++;    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsTime));
      this.frames = 0;
      this.lastFpsTime = now;
      this.cb.onStats({
        fps: this.fps,
        tris: Math.round(this.renderer.info.render.triangles / 1000),
        calls: this.renderer.info.render.calls,
        objects: this.objects.size,
      });
    }
  };

  dispose() {
    if (this.play) { this.play.dispose(); this.play = null; }
    this.collisionDebug?.dispose();
    this.collisionDebug = null;
    this.postfx?.dispose();
    this.ro?.disconnect();
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
