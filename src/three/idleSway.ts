import * as THREE from 'three';

/**
 * Анимация покоя для мехов.
 *
 * У машины нет «человеческого» простоя: человек в простое переминается, машина —
 * работает. Поэтому покой здесь механический: едва заметное покачивание корпуса
 * (как гудит реактор) и микронаклон. Никакого «танца» — иначе техника
 * выглядит живым человеком.
 *
 * Работает с любым мехом: и с GLB (узел 'torso' — пивот по поясу), и с процедурным.
 */

export interface IdleSwayOptions {
  /** Сила покачивания, 0 — выключить. */
  amount?: number;
  /** Время в секундах (для плавной фазы). */
  time?: number;
  /** Базовый поворот корпуса (например доворот на цель) — покачивание идёт от него. */
  baseYaw?: number;
}

/** Базовый поворот корпуса запоминаем один раз, чтобы покачивание не копилось. */
function baseOf(torso: THREE.Object3D): { x: number; y: number; z: number } {
  const saved = torso.userData.idleBase as { x: number; y: number; z: number } | undefined;
  if (saved) return saved;
  const base = { x: torso.rotation.x, y: torso.rotation.y, z: torso.rotation.z };
  torso.userData.idleBase = base;
  return base;
}

/** Найти узел корпуса: у GLB-меха это пивот 'torso', у процедурных — группа 'torso'. */
export function findTorso(mech: THREE.Object3D): THREE.Object3D | null {
  return mech.getObjectByName('torso') ?? null;
}

/**
 * Покачивание корпуса в покое.
 * Рыскание ~0.9°, наклон ~0.5° — едва заметно: мех выглядит живым, но не дёрганым.
 */
export function applyIdleSway(mech: THREE.Object3D, opts: IdleSwayOptions = {}): void {
  const amount = opts.amount ?? 1;
  const t = opts.time ?? 0;
  if (amount <= 0.0001) return;
  const torso = findTorso(mech);
  if (!torso) return;
  const base = baseOf(torso);
  const yaw = Math.sin(t * 0.62) * 0.0155 * amount;
  const pitch = Math.sin(t * 0.41 + 1.7) * 0.0087 * amount;
  const roll = Math.sin(t * 0.29 + 0.6) * 0.0052 * amount;
  torso.rotation.set(
    base.x + pitch,
    (opts.baseYaw !== undefined ? opts.baseYaw : base.y) + yaw,
    base.z + roll,
  );
}
