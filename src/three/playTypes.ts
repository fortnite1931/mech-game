import type { LootTable, Recipe } from '../game/playerKit.ts';
import { LOOT_TABLES, RECIPES } from '../game/playerKit.ts';

export type ViewMode = 'cockpit' | 'third' | 'shoulder' | 'tactical';
export type VisionMode = 'normal' | 'night' | 'thermal';
export type WeaponId = 'autocannon' | 'laser' | 'missiles' | 'mg' | 'none';
export type WeaponKind = 'projectile' | 'beam' | 'missile' | 'none';

export interface WeaponDef {
  id: WeaponId; name: string; short: string; kind: WeaponKind;
  damage: number; rof: number; heat: number; ammo: number | null;
  speed: number; color: number; glow: string; salvo: number; spread: number; range: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  autocannon: { id: 'autocannon', name: 'Автопушка AC/30', short: 'AC30', kind: 'projectile', damage: 18, rof: 3.5, heat: 6, ammo: 150, speed: 170, color: 0xffb060, glow: '#ffb060', salvo: 1, spread: 0.012, range: 260 },
  laser: { id: 'laser', name: 'Лазер PPC-II', short: 'PPC', kind: 'beam', damage: 32, rof: 0.9, heat: 24, ammo: null, speed: 0, color: 0x4ad8ff, glow: '#4ad8ff', salvo: 1, spread: 0, range: 320 },
  missiles: { id: 'missiles', name: 'Ракеты LRM-6', short: 'LRM6', kind: 'missile', damage: 14, rof: 0.45, heat: 16, ammo: 48, speed: 48, color: 0xffd080, glow: '#ff9040', salvo: 6, spread: 0.1, range: 400 },
  mg: { id: 'mg', name: 'Пулемёт 12.7', short: 'MG', kind: 'projectile', damage: 4, rof: 14, heat: 0.7, ammo: 900, speed: 230, color: 0xffe0a0, glow: '#ffe0a0', salvo: 1, spread: 0.03, range: 180 },
  none: { id: 'none', name: '— пусто —', short: '—', kind: 'none', damage: 0, rof: 1, heat: 0, ammo: null, speed: 0, color: 0xffffff, glow: '#fff', salvo: 0, spread: 0, range: 0 },
};
export const WEAPON_LIST: WeaponId[] = ['autocannon', 'laser', 'missiles', 'mg', 'none'];

export const VIEW_ORDER: ViewMode[] = ['cockpit', 'third', 'shoulder', 'tactical'];
export const VIEW_INFO: Record<ViewMode, { label: string; desc: string }> = {
  cockpit: { label: 'Кабина', desc: 'Вид из кабины пилота, HUD на бронестекле' },
  third: { label: 'Третье лицо', desc: 'Камера за мехом, орбита на зажатом СКМ' },
  shoulder: { label: 'Из-за плеча', desc: 'Ближний бой, прицельная стрельба' },
  tactical: { label: 'Тактический', desc: 'Изометрия как на референсах игры' },
};
export const VISION_ORDER: VisionMode[] = ['normal', 'night', 'thermal'];
export const VISION_INFO: Record<VisionMode, { label: string }> = {
  normal: { label: 'Обычный' },
  night: { label: 'Ночное видение' },
  thermal: { label: 'Тепловизор' },
};

export interface ChassisInfo { name: string; cockpit: [number, number, number]; radius: number; tonnage: number; speedMul: number; turnMul: number; }
export const CHASSIS: Record<string, ChassisInfo> = {
  mech_scout: { name: '«Ястреб»', cockpit: [0, 0.42, 0.95], radius: 1.5, tonnage: 35, speedMul: 1.25, turnMul: 1.3 },
  mech_juggernaut: { name: '«Титан»', cockpit: [-0.5, 0.35, 1.2], radius: 2.2, tonnage: 95, speedMul: 0.7, turnMul: 0.7 },
  mech_molot: { name: '«Молот»', cockpit: [-0.35, 0.3, 1.0], radius: 1.8, tonnage: 60, speedMul: 1.0, turnMul: 1.0 },
  mech_robot: { name: 'Мех «Робот»', cockpit: [0, 0.5, 0.9], radius: 1.6, tonnage: 45, speedMul: 1.15, turnMul: 1.2 },
  mech_industrial: { name: 'Мех «Индустриальный»', cockpit: [0, 0.55, 0.9], radius: 1.9, tonnage: 70, speedMul: 0.9, turnMul: 0.85 },
};

/** Кем и как начинаем играть: сразу в мехе или пешком за персонажем. */
export type PlayerStart = 'mech' | 'foot';
/** Где появляется игрок при старте превью. */
export type SpawnMode = 'spawn_object' | 'random' | 'camera';

export interface MechConfig {
  chassis: string;
  playerObjectId: string; // 'auto' | 'new' | object id
  /** Стартовать в мехе или сразу на земле, пешком персонажем. */
  playerStart: PlayerStart;
  /** Какого персонажа контролировать на земле: 'auto' | 'new' (временный) | id объекта. */
  pilotObjectId: string;
  /** Точка появления: флажок «Спавн» в сцене, случайная точка или у камеры. */
  spawnMode: SpawnMode;
  /** Скорости пилота пешком, м/с. */
  foot: { walk: number; run: number };
  /** На каком расстоянии (м) пилот может сесть в мех. */
  enterRange: number;
  /** Здоровье, выносливость и грузоподъёмность игрока. */
  vitals: { health: number; stamina: number; staminaRegen: number; runDrain: number; carryKg: number };
  defaultView: ViewMode;
  defaultVision: VisionMode;
  cockpit: { fov: number; height: number; forward: number; frameOpacity: number; scanlines: boolean; sway: number; pitchLimit: number };
  third: { distance: number; height: number; fov: number; smoothing: number; autoFollow: boolean };
  shoulder: { distance: number; height: number; side: number; fov: number };
  tactical: { distance: number; pitch: number; fov: number; autoFollow: boolean };
  hudColor: string;
  sensitivity: number;
  invertY: boolean;
  cameraNeedsMMB: boolean;
  weapons: WeaponId[];
  maxSpeed: number;   // km/h
  turnSpeed: number;  // deg/s
  torsoTwist: number; // deg
  accel: number;      // 0..1
  jumpJets: boolean;
  sfx: boolean;
}

export const DEFAULT_MECH_CONFIG: MechConfig = {
  chassis: 'mech_scout',
  playerObjectId: 'auto',
  playerStart: 'mech',
  pilotObjectId: 'auto',
  spawnMode: 'spawn_object',
  foot: { walk: 4.2, run: 9.5 },
  enterRange: 10,
  vitals: { health: 100, stamina: 100, staminaRegen: 18, runDrain: 12, carryKg: 120 },
  defaultView: 'third',
  defaultVision: 'normal',
  cockpit: { fov: 78, height: 0, forward: 0, frameOpacity: 0.9, scanlines: true, sway: 0.6, pitchLimit: 45 },
  third: { distance: 11, height: 3.4, fov: 55, smoothing: 7, autoFollow: true },
  shoulder: { distance: 5.5, height: 4.0, side: 1.9, fov: 50 },
  tactical: { distance: 26, pitch: 52, fov: 42, autoFollow: false },
  hudColor: '#7cf5b0',
  sensitivity: 1,
  invertY: false,
  cameraNeedsMMB: true,
  weapons: ['autocannon', 'laser', 'missiles', 'mg'],
  maxSpeed: 34,
  turnSpeed: 70,
  torsoTwist: 110,
  accel: 0.6,
  jumpJets: true,
  sfx: true,
};

export function mergeMechConfig(saved: Partial<MechConfig>): MechConfig {
  return { ...DEFAULT_MECH_CONFIG, ...saved,
    foot: { ...DEFAULT_MECH_CONFIG.foot, ...saved.foot },
    vitals: { ...DEFAULT_MECH_CONFIG.vitals, ...saved.vitals },
    cockpit: { ...DEFAULT_MECH_CONFIG.cockpit, ...saved.cockpit },
    third: { ...DEFAULT_MECH_CONFIG.third, ...saved.third },
    shoulder: { ...DEFAULT_MECH_CONFIG.shoulder, ...saved.shoulder },
    tactical: { ...DEFAULT_MECH_CONFIG.tactical, ...saved.tactical },
  };
}

export interface HudWeapon { slot: number; id: WeaponId; name: string; short: string; ammo: number | null; ready: number; selected: boolean; }
export interface HudState {
  view: ViewMode; vision: VisionMode;
  speedKmh: number; throttle: number; heading: number;
  heat: number; overheated: boolean; jetFuel: number; hasJets: boolean; airborne: boolean;
  weapons: HudWeapon[]; kills: number; shots: number; targetsLeft: number;
  log: string[]; pos: [number, number]; yaw: number; torsoOffsetDeg: number;
  target: { name: string; hp: number } | null;
  chassisName: string; showHelp: boolean; time: number;
  php: number; pmax: number; wave: number; wavesTotal: number; enemiesLeft: number;
  /** Прочность меха игрока (0 — игрок пешком). */
  mechHp?: number; mechMaxHp?: number;
  /** Ближайший мех, в который можно сесть (когда игрок пешком). */
  nearestMech?: { name: string; dist: number } | null;
  /** Ближайшая незачищенная зона карты. */
  zone?: { name: string; left: number } | null;
  over: null | 'won' | 'lost'; hurt: number;
  /** Пилот вне кабины: WASD — свободное движение, ЛКМ по меху — сесть. */
  ejected?: boolean;
  /** Выносливость 0..1 — тратится на бег. */
  stamina?: number;
  /** Инвентарь и вес для панели в превью. */
  bag?: { item: string; short: string; name: string; n: number }[];
  bagWeight?: number;
  bagCapacity?: number;
  /** Доступные постройки базы (для панели «Стройка», T). */
  buildOptions?: { kind: string; name: string; cost: string; ok: boolean }[];
  /** Подсказка: ближайший контейнер с лутпом (что можно подобрать). */
  nearLoot?: string | null;
}

export type EnemyKindId = 'turret' | 'mech_scout' | 'mech_juggernaut' | 'mech_molot' | 'infantry';
export const ENEMY_KINDS: EnemyKindId[] = ['turret', 'mech_scout', 'mech_juggernaut', 'mech_molot', 'infantry'];
export const ENEMY_KIND_INFO: Record<EnemyKindId, { label: string }> = {
  turret: { label: 'Турель «Шершень»' },
  mech_scout: { label: 'Мех «Ястреб»' },
  mech_juggernaut: { label: 'Мех «Титан»' },
  mech_molot: { label: 'Мех «Молот»' },
  infantry: { label: 'Пехота (человек)' },
};

/** Поведение NPC: маршрут, реакция на игрока, привязка к базе. */export interface NpcSettings {
  enabled: boolean;
  /** Радиус маршрута вокруг точки появления, м. */
  patrolRadius: number;
  /** Доля от боевой скорости на патруле (0.1–1). */
  patrolSpeed: number;
  /** Сколько точек в маршруте. */
  waypoints: number;
  /** Пауза на точке, с. */
  pauseSec: number;
  /** Дистанция обнаружения игрока, м. */
  aggro: number;
  /** Задержка реакции перед атакой, с. */
  alertSec: number;
  /** Насколько можно отойти от базы в погоне, м. */
  leash: number;
  /** Возвращаться на базу и забыть игрока. */
  returnHome: boolean;
}

export const DEFAULT_NPC: NpcSettings = {
  enabled: true,
  patrolRadius: 14,
  patrolSpeed: 0.4,
  waypoints: 4,
  pauseSec: 2.5,
  aggro: 42,
  alertSec: 0.8,
  leash: 60,
  returnHome: true,
};

export interface WaveDef {
  name: string; count: number; kinds: EnemyKindId[]; delaySec: number; radius: number;
}
export interface Scenario {
  playerHp: number; enemyHpMul: number; enemyDmgMul: number; waves: WaveDef[]; npc: NpcSettings;
  /** Таблицы лута — редактируются в панели, хранятся в проекте. */
  loot: LootTable[];
  /** Рецепты сборки меха — редактируются в панели, хранятся в проекте. */
  craft: Recipe[];
  /** Общие переключатели сбора: мусор, автоподбор, разбор машин. */
  lootSettings: LootSettings;
}
/** Единые настройки добычи — источник правды для превью и редактора. */
export interface LootSettings {
  /** Лут с мусора на карте. */
  enabled: boolean;
  /** Подбирать автоматически вблизи. */
  autoPickup: boolean;
  /** Множитель шансов/количества для мусорного лута. */
  rarityBoost: number;
  /** Разбирать уничтоженные машины. */
  salvage: boolean;
  /** Множитель для разбора (трофейный режим). */
  salvageMul: number;
}

export const DEFAULT_LOOT_SETTINGS: LootSettings = {
  enabled: true, autoPickup: true, rarityBoost: 0, salvage: true, salvageMul: 1,
};

export const DEFAULT_SCENARIO: Scenario = {
  playerHp: 300, enemyHpMul: 1, enemyDmgMul: 1,
  npc: { ...DEFAULT_NPC },
  loot: LOOT_TABLES.map((t) => ({ ...t, entries: t.entries.map((e) => ({ ...e })) })),
  craft: RECIPES.map((r) => ({ ...r, parts: r.parts.map((p) => ({ ...p })) })),
  lootSettings: { ...DEFAULT_LOOT_SETTINGS },
  waves: [
    { name: 'Разведка', count: 3, kinds: ['turret', 'mech_scout'], delaySec: 5, radius: 70 },
    { name: 'Пехота', count: 4, kinds: ['infantry', 'mech_scout'], delaySec: 8, radius: 60 },
    { name: 'Тяжёлые', count: 4, kinds: ['mech_molot', 'mech_scout', 'turret'], delaySec: 8, radius: 75 },
    { name: 'Титан', count: 2, kinds: ['mech_juggernaut', 'mech_molot'], delaySec: 10, radius: 80 },
  ],
};

