import type { BehaviorId } from '../../game/behaviors.ts';
import type { PropValues } from '../../game/props.ts';
import { resolveType, type ObjectType } from '../../game/types.ts';
import { readMovement, movementDefaults, type MovementSettings } from './movement.ts';
import { readWeapons, weaponsDefaults, type WeaponsSettings } from './weapons.ts';

export type RuntimeBehaviors = Record<string, PropValues | undefined>;

export interface ResolvedRuntime {
  typeId?: string;
  role: string;
  settings: RuntimeBehaviors;
  movement: MovementSettings;
  weapons: WeaponsSettings;
}

/** Настройки поведений типа объекта с учётом наследования. */
export function resolveRuntime(typeId: string | undefined, types: ObjectType[]): ResolvedRuntime {
  const resolved = typeId ? resolveType(typeId, types) : null;
  const settings: RuntimeBehaviors = {};
  for (const b of resolved?.behaviors ?? []) settings[b.id] = b.settings;
  const type = resolved?.type;
  return {
    typeId,
    role: type?.role ?? 'neutral',
    settings,
    movement: readMovement(settings.movement),
    weapons: readWeapons(settings.weapons),
  };
}

export function settingOf(rt: ResolvedRuntime, id: BehaviorId): PropValues | undefined {
  return rt.settings[id];
}

export function isEnabled(rt: ResolvedRuntime, id: BehaviorId): boolean {
  return rt.settings[id] !== undefined;
}

export { movementDefaults, weaponsDefaults };
export type { MovementSettings, WeaponsSettings };

export {
  readMovement, stepMovement, moveDistance,
} from './movement.ts';
export type { MovementState, MoveInput, MoveEnv } from './movement.ts';

export {
  readWeapons, makeCooldowns, tickWeapons, tryFireSlot, slotDefs, salvoGap,
} from './weapons.ts';
export type { WeaponCooldown, HeatState, FireResult } from './weapons.ts';