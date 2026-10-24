import type { PropValues } from '../../game/props.ts';
import { WEAPONS, WEAPON_LIST, type WeaponDef, type WeaponId } from '../playTypes.ts';

export interface WeaponsSettings {
  slots: WeaponId[];
  rateMul: number;
  salvoMul: number;
  spreadMul: number;
  heatMul: number;
  overheatCooldown: number;
  rangeMul: number;
  salvoGap: number;
  overheatDelay: number;
  overheatLimit: number;
}

export interface WeaponCooldown {
  id: WeaponId;
  cd: number;
  ammo: number | null;
}

export interface HeatState {
  heat: number;
  overheated: boolean;
  overheatT: number;
}

export interface FireResult {
  fired: boolean;
  shot: WeaponDef | null;
  heat: number;
  spread: number;
  speed: number;
  range: number;
  salvoCount: number;
  overheated: boolean;
}

export function weaponsDefaults(): WeaponsSettings {
  return {
    slots: ['autocannon', 'laser', 'missiles', 'mg'],
    rateMul: 1,
    salvoMul: 1,
    spreadMul: 1,
    heatMul: 1,
    overheatCooldown: 22,
    rangeMul: 1,
    salvoGap: 0.09,
    overheatDelay: 3.5,
    overheatLimit: 100,
  };
}

export function readWeapons(settings: PropValues | undefined): WeaponsSettings {
  const d = weaponsDefaults();
  if (!settings) return d;
  const num = (k: string, f: number) => {
    const v = Number(settings[k]);
    return Number.isFinite(v) ? v : f;
  };
  const slots: WeaponId[] = [];
  for (let i = 1; i <= 4; i++) {
    const v = String(settings[`slot${i}`] ?? '') as WeaponId;
    if (WEAPON_LIST.includes(v) && v !== 'none') slots.push(v);
  }
  return {
    slots: slots.length ? slots : d.slots,
    rateMul: num('rateMul', d.rateMul),
    salvoMul: num('salvoMul', d.salvoMul),
    spreadMul: num('spreadMul', d.spreadMul),
    heatMul: num('heatMul', d.heatMul),
    overheatCooldown: num('overheatCooldown', d.overheatCooldown),
    rangeMul: num('rangeMul', d.rangeMul),
    salvoGap: d.salvoGap,
    overheatDelay: d.overheatDelay,
    overheatLimit: d.overheatLimit,
  };
}

export function slotDefs(cfg: WeaponsSettings): WeaponDef[] {
  return cfg.slots.map((id) => WEAPONS[id] ?? WEAPONS.none);
}

export function makeCooldowns(cfg: WeaponsSettings): WeaponCooldown[] {
  return slotDefs(cfg).map((def) => ({ id: def.id, cd: 0, ammo: def.ammo }));
}

/** Кулдауны и перегрев за кадр. */
export function tickWeapons(dt: number, cds: WeaponCooldown[], heat: HeatState, cfg: WeaponsSettings): { cooled: boolean } {
  let cooled = false;
  for (const c of cds) c.cd = Math.max(0, c.cd - dt);
  const coolRate = heat.overheated ? cfg.overheatCooldown * 1.15 : cfg.overheatCooldown * 0.6;
  heat.heat = Math.max(0, heat.heat - coolRate * dt);
  if (heat.overheated) {
    heat.overheatT -= dt;
    if (heat.overheatT <= 0) {
      heat.overheated = false;
      heat.heat = 0;
      cooled = true;
    }
  }
  return { cooled };
}

/** Попытка выстрела из слота: темп, залп, разброс, перегрев, патроны. */
export function tryFireSlot(
  slot: number,
  cds: WeaponCooldown[],
  heat: HeatState,
  cfg: WeaponsSettings,
): FireResult {
  const cd = cds[slot];
  const def = cd ? WEAPONS[cd.id] ?? WEAPONS.none : WEAPONS.none;
  const fail: FireResult = { fired: false, shot: null, heat: heat.heat, spread: 0, speed: 0, range: 0, salvoCount: 0, overheated: heat.overheated };
  if (!cd || def.kind === 'none' || cd.cd > 0 || heat.overheated) return fail;
  if (cd.ammo !== null) {
    if (cd.ammo <= 0) return fail;
    cd.ammo -= def.salvo;
  }
  cd.cd = def.rof > 0 ? 1 / (def.rof * cfg.rateMul) : 0.3;
  heat.heat = Math.min(cfg.overheatLimit, heat.heat + def.heat * cfg.heatMul);
  const justOverheated = heat.heat >= cfg.overheatLimit;
  if (justOverheated) {
    heat.overheated = true;
    heat.overheatT = cfg.overheatDelay;
  }
  return {
    fired: true,
    shot: def,
    heat: heat.heat,
    spread: def.spread * cfg.spreadMul,
    speed: def.speed,
    range: def.range * cfg.rangeMul,
    salvoCount: Math.max(1, Math.round(def.salvo * cfg.salvoMul)),
    overheated: justOverheated,
  };
}

/** Задержка между выстрелами залпа. */
export function salvoGap(cfg: WeaponsSettings): number {
  return cfg.salvoGap;
}