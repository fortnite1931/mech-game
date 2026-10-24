import { DEFAULT_ENV } from '../three/envDefaults.ts';
import { DEFAULT_MECH_CONFIG, DEFAULT_SCENARIO, mergeMechConfig, CHASSIS } from '../three/playTypes.ts';
import type { Scenario } from '../three/playTypes.ts';
import { BEHAVIORS, CHASSIS_IDS, type BehaviorId } from './behaviors.ts';
import {
  ROLE_LABEL, defaultBehaviors, makeType, normalizeType,
  type BehaviorInstance, type ObjectType, type Role,
} from './types.ts';
import { coerceProp, coerceProps, defaultValues, type PropKind, type PropValue } from './props.ts';
import { objectRoleToTypeRole } from './objectRole.ts';
import { normalizeCraft, normalizeLoot } from './playerKit.ts';
import { ACTION_DEFS, CONDITION_DEFS, EVENT_DEFS } from './sheets.ts';
import { buildSheets } from './gameSheets.ts';

export const PROJECT_VERSION = '2.0';
export const PROJECT_APP = 'WASTELAND FORGE';

export interface GlobalVar {
  id: string;
  name: string;
  kind: PropKind;
  def: PropValue;
}

export interface ActionSpec { action: string; params: Record<string, PropValue> }
export interface ConditionSpec { condition: string; params: Record<string, PropValue> }
export interface EventRow {
  id: string;
  event: string;
  comment?: string;
  condition?: ConditionSpec;
  then: ActionSpec[];
  else: ActionSpec[];
  children: EventRow[];
}
export interface EventSheet {
  id: string;
  name: string;
  comment?: string;
  rows: EventRow[];
}

export interface SceneEntry {
  id: string;
  typeId?: string;
  role: Role;
  name: string;
}

export interface ExportedSound {
  id: string;
  name: string;
  mime: string;
  duration?: number;
  data: string;
}

export interface ProjectV2 {
  meta: { app: string; version: string; exportedAt?: string; engine?: string };
  environment: unknown;
  world: unknown;
  globals: GlobalVar[];
  types: ObjectType[];
  sheets: EventSheet[];
  scene: SceneEntry[];
  sounds: ExportedSound[];
  player: unknown;
  scenario: unknown;
}

export const EVENT_CATALOG = EVENT_DEFS;
export const ACTION_CATALOG = ACTION_DEFS;
export const CONDITION_CATALOG = CONDITION_DEFS;

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}${uid.toString(36)}`;
}

function behavior(id: BehaviorId, settings: Record<string, PropValue> = {}, enabled = true): BehaviorInstance {
  return { id, enabled, settings: coerceProps(BEHAVIORS[id].props, { ...defaultValues(BEHAVIORS[id].props), ...settings }) };
}

function chassisType(id: string, name: string, role: Role, chassisKey: string, playerStart: boolean, assetId: string, desc: string): ObjectType {
  const ch = CHASSIS[chassisKey];
  return makeType({
    id, name, role, category: 'mech', assetId, desc, parentTypeId: 'type_mech',
    props: { chassis: chassisKey, tonnage: ch.tonnage },
    behaviors: [
      behavior('movement', {
        maxSpeed: Math.round(34 * (ch.speedMul ?? 1)),
        turnSpeed: Math.round(70 * (ch.turnMul ?? 1)),
      }),
      behavior('weapons'),
      behavior('camera'),
      behavior('cockpit'),
      behavior('survivability', { maxHp: Math.round(300 * (ch.tonnage / 35)) }),
      behavior('pilot', { pilotable: true, playerStart, pilotName: 'Пилот' }),
      behavior('ai_mech'),
    ],
  });
}

/** Базовый тип «Мех» — общий предок всех шасси. */
export function baseMechType(): ObjectType {
  return makeType({
    id: 'type_mech', name: 'Мех (базовый)', category: 'mech', role: 'neutral',
    desc: 'Общие настройки для всех шасси. Наследники переопределяют нужные поля.',
    props: { chassis: 'mech_scout', tonnage: 35 },
    behaviors: defaultBehaviors(['movement', 'weapons', 'camera', 'cockpit', 'survivability', 'pilot', 'ai_mech']),
  });
}

export function defaultTypes(): ObjectType[] {
  const base = baseMechType();
  return [
    base,
    chassisType('type_player', 'Мех игрока (спавн)', 'player', 'mech_scout', true, 'mech_scout', 'Точка, где в превью появится мех игрока, и источник его настроек (шасси, оружие, камера). Присвоив его объекту, НЕ играешь этим телом — для этого есть роль «Управляемый мех».'),
    chassisType('type_mech_scout', '«Ястреб» — разведчик', 'enemy', 'mech_scout', false, 'mech_scout', 'Лёгкий быстрый враг.'),
    chassisType('type_mech_juggernaut', '«Титан» — тяжёлый', 'enemy', 'mech_juggernaut', false, 'mech_juggernaut', 'Тяжёлый штурмовой враг.'),
    chassisType('type_mech_molot', '«Молот» — штурмовик', 'enemy', 'mech_molot', false, 'mech_molot', 'Средний боевой враг.'),
    chassisType('type_reserve_mech', 'Резервный мех (точка пересадки)', 'reserve', 'mech_juggernaut', false, 'mech_juggernaut', 'Точка пересадки: после гибели первого меха сюда пересядет пилот. Роль «Запасной мех» в инспекторе — кем играешь этим объектом, тип — откуда он появляется.'),
    makeType({
      id: 'type_pilot', name: 'Пилот', category: 'pilot', role: 'neutral',
      desc: 'Персонаж вне меха. Выходит из машины и может сесть в любой резерв.',
      behaviors: [
        behavior('movement', { maxSpeed: 14, accel: 0.9, turnSpeed: 180, jumpJets: false, jetThrust: 0, gravity: 0, jetRefill: 0 }),
        behavior('survivability', { maxHp: 100, destroyOnDeath: true }),
        behavior('pilot', { pilotable: false, allowEject: true, pilotName: 'Пилот' }),
        behavior('prop_physics', { mass: 'light', stepOver: true, kick: 0.1 }),
        behavior('destroyable', { hp: 60 }),
      ],
    }),
    makeType({
      id: 'type_turret', name: 'Турель «Шершень»', category: 'turret', role: 'enemy', assetId: 'turret',
      desc: 'Стационарная турель, ведёт огонь по пилоту.',
      behaviors: [behavior('ai_turret'), behavior('destroyable', { hp: 120 }), behavior('prop_physics', { mass: 'heavy' })],
    }),
    makeType({
      id: 'type_barrel_fuel', name: 'Бочка с топливом', category: 'prop', role: 'neutral', assetId: 'barrel',
      desc: 'Детонирует по цепочке.', props: { contents: 'fuel' },
      behaviors: [behavior('prop_physics', { mass: 'medium', stepOver: true }), behavior('destroyable', { hp: 20, contents: 'fuel' })],
    }),
    makeType({
      id: 'type_barrel_tox', name: 'Бочка токсичная', category: 'prop', role: 'neutral', assetId: 'barrel_tox',
      props: { contents: 'tox' },
      behaviors: [behavior('prop_physics', { mass: 'medium', stepOver: true }), behavior('destroyable', { hp: 20, contents: 'tox' })],
    }),
  ];
}

export function defaultSheets(): EventSheet[] {
  return buildSheets();
}

export function defaultGlobals(): GlobalVar[] {
  return [
    { id: 'var_wave', name: 'Номер волны', kind: 'number', def: 0 },
    { id: 'var_enemies_left', name: 'Врагов осталось', kind: 'number', def: 0 },
    { id: 'var_waves_total', name: 'Волн всего', kind: 'number', def: 3 },
    { id: 'var_pilot_mech', name: 'Мех пилота', kind: 'string', def: '' },
  ];
}

export function emptyProject(): ProjectV2 {
  return {
    meta: { app: PROJECT_APP, version: PROJECT_VERSION },
    environment: { ...DEFAULT_ENV },
    world: null,
    globals: defaultGlobals(),
    types: defaultTypes(),
    sheets: defaultSheets(),
    scene: [],
    sounds: [],
    player: { ...DEFAULT_MECH_CONFIG },
    scenario: JSON.parse(JSON.stringify(DEFAULT_SCENARIO)),
  };
}

/** Старый плоский формат → проект v2. Ничего не теряем: player/scenario/world сохранены как есть. */
export function migrateV1toV2(data: unknown): ProjectV2 {
  const src = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const types = defaultTypes().map((t) => normalizeType(t, []));
  const player = mergeMechConfig((src.player ?? {}) as Partial<typeof DEFAULT_MECH_CONFIG>);

  const objects = Array.isArray(src.objects) ? src.objects : [];
  const scene: SceneEntry[] = objects.map((o) => {
    const rec = o as { id?: string; name?: string; assetId?: string; role?: string; typeId?: string };
    const assetId = rec.assetId ?? '';
    const typeId = rec.typeId
      ?? types.find((t) => t.assetId === assetId && t.role === 'enemy')?.id
      ?? types.find((t) => t.assetId === assetId)?.id
      ?? 'type_barrel_fuel';
    return {
      id: rec.id ?? nextId('obj'),
      typeId,
      // роли объекта переносим в систему типов без потерь:
      // «мех игрока» → player, «резерв» → reserve, «точка спавна» → reserve
      role: objectRoleToTypeRole(rec.role) as Role,
      name: rec.name ?? assetId,
    };
  });

  return {
    meta: { app: PROJECT_APP, version: PROJECT_VERSION, engine: 'three.js' },
    environment: (src.environment ?? { ...DEFAULT_ENV }) as unknown,
    world: src.world ?? null,
    globals: defaultGlobals(),
    types,
    sheets: defaultSheets(),
    scene,
    sounds: Array.isArray(src.sounds) ? src.sounds : [],
    player,
    scenario: src.scenario ?? JSON.parse(JSON.stringify(DEFAULT_SCENARIO)),
  };
}

function isV2(data: unknown): data is ProjectV2 {
  return !!data && typeof data === 'object'
    && Array.isArray((data as ProjectV2).types)
    && (data as ProjectV2).meta?.version === PROJECT_VERSION;
}

/** Любой вход (v1 или v2) → валидный проект v2. Никогда не бросает. */
export function ensureProject(data: unknown): ProjectV2 {
  if (isV2(data)) {
    const p = data as ProjectV2;
    const base = emptyProject();
    return {
      ...base,
      ...p,
      meta: { ...base.meta, ...p.meta },
      globals: Array.isArray(p.globals) && p.globals.length ? p.globals : base.globals,
      types: (Array.isArray(p.types) && p.types.length ? p.types : base.types).map((t) => normalizeType(t, p.types ?? [])),
      sheets: Array.isArray(p.sheets) ? p.sheets : base.sheets,
      scene: Array.isArray(p.scene) ? p.scene : [],
      sounds: Array.isArray(p.sounds) ? p.sounds : [],
      scenario: normalizeScenario(p.scenario),
    };
  }
  return migrateV1toV2(data);
}

/** Сценарий: досоставляем поля, которых не было в старых проектах. */
export function normalizeScenario(raw: unknown): Scenario {
  const base = JSON.parse(JSON.stringify(DEFAULT_SCENARIO)) as Scenario;
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<Scenario>;
  return {
    ...base,
    ...s,
    npc: { ...base.npc, ...(s.npc ?? {}) },
    lootSettings: { ...base.lootSettings, ...(s.lootSettings ?? {}) },
    loot: normalizeLoot(s.loot),
    craft: normalizeCraft(s.craft),
    waves: Array.isArray(s.waves) ? s.waves : base.waves,
  };
}

export function projectToJSON(project: ProjectV2, objects: unknown[], exportedAt: string, sounds: ExportedSound[] = []): string {
  return JSON.stringify({
    meta: { ...project.meta, exportedAt },
    types: project.types,
    sheets: project.sheets,
    globals: project.globals,
    scene: project.scene,
    sounds,
    environment: project.environment,
    world: project.world,
    player: project.player,
    scenario: project.scenario,
    objects,
  }, null, 2);
}

export { ROLE_LABEL, CHASSIS_IDS, coerceProp };