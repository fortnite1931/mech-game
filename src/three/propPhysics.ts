// Pure, THREE-free physics profiles + impulse math for world props.
// Used by PlayController for body-push, footstep crush and step-over logic.

export type PropMass = 'light' | 'medium' | 'heavy';

export interface PropProfile {
  mass: PropMass;
  /** low profile: mech can step over it (no blocking) when top is below STEP_OVER_HEIGHT */
  stepOver: boolean;
  /** impulse gain when the hull bumps it */
  kick: number;
  /** destroyed (squashed) when stepped on / landed on; non-squashable light props get kicked away instead */
  squashable: boolean;
  /** round objects roll around their axle instead of spinning in place */
  rollable: boolean;
}

/** Max height (м) of a blocking prop the mech steps over instead of colliding. */
export const STEP_OVER_HEIGHT = 0.65;

const P = (mass: PropMass, kick: number, squashable: boolean, stepOver = false, rollable = false): PropProfile =>
  ({ mass, kick, squashable, stepOver, rollable });

export const PROP_PROFILES: Record<string, PropProfile> = {
  // лёгкое — отлетает от корпуса, сминается/раскатывается под ногой
  cone: P('light', 1.5, true, true),
  grass: P('light', 1.8, true, true),
  bush: P('light', 1.4, true, true),
  crate: P('light', 1.0, true, true),
  tires: P('light', 1.15, false, true, true),
  // среднее — сдвигается только с ходу, под ногой сминается
  scrap: P('medium', 0.45, false, true),
  barrel: P('medium', 0.6, true),
  barrel_group: P('medium', 0.4, true),
  // тяжёлое — блокирует, низкое (арматура, рельсы, кирпич) — перешагивается
  bricks: P('heavy', 0, false, true),
  rails: P('heavy', 0, false, true),
  girder: P('medium', 0.35, true, true),
  slab: P('heavy', 0, false),
  car_wreck: P('heavy', 0, false),
  container: P('heavy', 0, false),
  rock: P('heavy', 0, false),
  husk: P('heavy', 0, false),
  bunker_wall: P('heavy', 0, false),
  barrier: P('heavy', 0, false),
  barrier_broken: P('heavy', 0, false),
  sandbags: P('heavy', 0, false, true),
  lamp: P('heavy', 0, false),
  antenna: P('heavy', 0, false),
  dead_tree: P('heavy', 0, false),
  watchtower: P('heavy', 0, false),
  generator: P('heavy', 0, false),
  outpost: P('heavy', 0, false),
  dome: P('heavy', 0, false),
  checkpoint: P('heavy', 0, false),
  sp_flag: P('heavy', 0, false),
  turret: P('heavy', 0, false),
};

export function propProfile(kind: string): PropProfile {
  if (kind === 'barrel_group') return PROP_PROFILES.barrel_group;
  if (kind.startsWith('barrel')) return PROP_PROFILES.barrel;
  return PROP_PROFILES[kind] ?? P('heavy', 0, false);
}

/** Does this prop block a mech whose feet are at footY and the prop top is topY? */
export function blocksMovement(prof: PropProfile, topY: number, footY: number): boolean {
  if (prof.mass !== 'heavy') return false;
  if (prof.stepOver && topY - footY < STEP_OVER_HEIGHT) return false;
  return true;
}

export interface Box2 { minX: number; minZ: number; maxX: number; maxZ: number }


/**
 * Hull-vs-prop impulse. Direction points from the mech to the prop (or along
 * motion if the centers coincide). Magnitude = momentum component along that
 * direction + a tonnage/kick shove. Pure so it is unit-testable.
 */
export function impactImpulse(
  px: number, pz: number, pvx: number, pvz: number,
  box: Box2, tonnage: number, prof: PropProfile,
): { nx: number; nz: number; mag: number } {
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  let nx = cx - px, nz = cz - pz;
  const d = Math.hypot(nx, nz);
  if (d < 1e-4) {
    const v = Math.hypot(pvx, pvz);
    nx = v > 1e-6 ? pvx / v : 1; nz = v > 1e-6 ? pvz / v : 0;
  } else { nx /= d; nz /= d; }
  const along = pvx * nx + pvz * nz;
  const m = prof.mass === 'light' ? 1 : prof.mass === 'medium' ? 0.55 : 0;
  const mag = Math.max(0, along) * 0.8 * m + prof.kick * m * (0.6 + tonnage / 70);
  return { nx, nz, mag };
}

/** Impulse decay factor per second for a pushed prop. */
export const PROP_DAMPING = 2.2;
/** Gravity for airborne props, м/с². */
export const PROP_GRAVITY = 22;
/** Bounce restitution on ground hit. */
export const PROP_BOUNCE = 0.3;

/** Unscaled, unrotated local AABB of a baked prop kind. */
export interface LocalBounds { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }

/**
 * World-space bounds for a prop instance: scale then rotate the local AABB by
 * yaw around the origin, then translate. Center and half-extents are computed
 * with |cos|/|sin| so a long rotated slab blocks exactly where it lies.
 * Pure — unit-testable, no THREE dependency.
 */
export function instanceBounds(
  local: LocalBounds, x: number, z: number, y: number, scale: number, rotY: number,
): { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number } {
  const cx = (local.minX + local.maxX) / 2, cz = (local.minZ + local.maxZ) / 2;
  const hx = (local.maxX - local.minX) / 2 * scale, hz = (local.maxZ - local.minZ) / 2 * scale;
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  // rotating a rect: new half extents = |cos|*hx + |sin|*hz (swapped for the other axis)
  const wx = c * hx + s * hz, wz = s * hx + c * hz;
  const rx = cx * Math.cos(rotY) + cz * Math.sin(rotY);
  const rz = -cx * Math.sin(rotY) + cz * Math.cos(rotY);
  return {
    minX: x + (rx * scale) - wx, maxX: x + (rx * scale) + wx,
    minZ: z + (rz * scale) - wz, maxZ: z + (rz * scale) + wz,
    minY: y + local.minY * scale, maxY: y + local.maxY * scale,
  };
}
