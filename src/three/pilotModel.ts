import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Пилот — GLB с текстурой, скелетом (29 костей) и клипами:
 * Walk / Run_Anime / Climb_Wall / Fixing_Kneeling + Idle_A (отдельный GLB).
 *
 * Анимация — настоящий AnimationMixer по скелету. Клонирование — только
 * SkeletonUtils.clone: обычный .clone() рвёт связь SkinnedMesh со скелетом,
 * и модель не видна/зависает в T-позе.
 */

const PILOT_URL = '/library/pilot_anim.glb';
const PILOT_IDLE_URL = '/library/pilot_idle.glb';
const PILOT_HEIGHT = 1.8;

let cachedRigged: THREE.Group | null = null;
let clips: THREE.AnimationClip[] = [];
const listeners: Array<() => void> = [];

function loadPilotAsync() {
  const loader = new GLTFLoader();
  let idleClips: THREE.AnimationClip[] | null = null;
  let main: { scene: THREE.Group; anims: THREE.AnimationClip[] } | null = null;
  const finish = () => {
    if (!main) return;
    clips = [...main.anims, ...(idleClips ?? [])];
    if (main.scene) {
      // SkeletonUtils.clone сохраняет связь SkinnedMesh <-> скелет
      const scene = skeletonClone(main.scene) as THREE.Group;
      scene.name = 'pilot';
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const s = Math.max(0.0001, PILOT_HEIGHT / Math.max(0.001, size.y));
      scene.scale.setScalar(s);
      scene.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y; // ноги на уровне y=0
      cachedRigged = scene;
      cachedRigged.name = 'pilot';
      for (const fn of listeners.splice(0)) fn();
    }
  };
  loader.load(PILOT_URL, (glb) => {
    main = { scene: glb.scene, anims: glb.animations ? glb.animations.slice() : [] };
    finish();
  }, undefined, (err) => console.error('Pilot GLB load error', err));
  // Idle_A из отдельного GLB (mesh2motion): тот же скелет, грузится в фоне
  loader.load(PILOT_IDLE_URL, (glb) => {
    idleClips = glb.animations ? glb.animations.slice() : [];
    if (!main) { if (idleClips.length) finish(); return; }
    clips = clips.filter((c) => !idleClips!.some((i) => i.name === c.name)).concat(idleClips);
    for (const fn of listeners) fn();
  }, undefined, (err) => console.warn('Pilot idle GLB load error', err));
}
loadPilotAsync();

/** Готовая модель пилота (null, если ещё грузится). */
export function getPilotModel(): THREE.Group | null {
  return cachedRigged;
}

/** Клипы пилота (4 штуки из Pilot_Anim.glb). */
export function getPilotAnimationClips(): THREE.AnimationClip[] {
  return clips;
}

/** Правильный клон пилота со скелетом (для AnimationMixer). */
export function clonePilot(): THREE.Group | null {
  return cachedRigged ? (skeletonClone(cachedRigged) as THREE.Group) : null;
}

/** Подписка на завершение загрузки модели. */
export function onPilotReady(fn: () => void): void {
  if (cachedRigged) fn();
  else listeners.push(fn);
}
