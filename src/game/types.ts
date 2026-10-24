import { coerceProps, defaultValues, type PropValues } from './props.ts';
import { BEHAVIORS, BEHAVIOR_IDS, type BehaviorId } from './behaviors.ts';

export type Role = 'player' | 'enemy' | 'reserve' | 'neutral';
export type TypeCategory = 'mech' | 'pilot' | 'turret' | 'prop' | 'marker';

export const ROLE_LABEL: Record<Role, string> = {
  player: 'Игрок',
  enemy: 'Враг',
  reserve: 'Резерв',
  neutral: 'Нейтральный',
};

export const CATEGORY_LABEL: Record<TypeCategory, string> = {
  mech: 'Мех',
  pilot: 'Пилот',
  turret: 'Турель',
  prop: 'Проп',
  marker: 'Маркер',
};

export interface BehaviorInstance {
  id: BehaviorId;
  enabled: boolean;
  settings: PropValues;
}

export interface ObjectType {
  id: string;
  name: string;
  category: TypeCategory;
  role: Role;
  parentTypeId?: string;
  assetId?: string;
  desc?: string;
  props: PropValues;
  behaviors: BehaviorInstance[];
}

export interface ResolvedType {
  type: ObjectType;
  chain: string[];
  props: PropValues;
  behaviors: BehaviorInstance[];
}

export function defaultBehaviors(ids: BehaviorId[]): BehaviorInstance[] {
  return ids.map((id) => ({ id, enabled: true, settings: defaultValues(BEHAVIORS[id].props) }));
}

export function makeType(partial: Partial<ObjectType> & { id: string; name: string }): ObjectType {
  const category = partial.category ?? 'prop';
  const behaviors = partial.behaviors ?? defaultBehaviors(defaultBehaviorsFor(category));
  return {
    id: partial.id,
    name: partial.name,
    category,
    role: partial.role ?? 'neutral',
    parentTypeId: partial.parentTypeId,
    assetId: partial.assetId,
    desc: partial.desc,
    props: partial.props ?? {},
    behaviors,
  };
}

export function defaultBehaviorsFor(category: TypeCategory): BehaviorId[] {
  if (category === 'mech') return ['movement', 'weapons', 'camera', 'cockpit', 'survivability', 'pilot', 'ai_mech'];
  if (category === 'pilot') return ['movement', 'survivability', 'pilot', 'prop_physics', 'destroyable'];
  if (category === 'turret') return ['ai_turret', 'destroyable', 'prop_physics'];
  return ['prop_physics', 'destroyable'];
}

/** Цепочка от корня к потомку. Защищена от зацикливания. */
export function typeChain(typeId: string, all: ObjectType[]): string[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = typeId;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.unshift(cur);
    cur = byId.get(cur)?.parentTypeId;
  }
  return chain;
}

export function wouldCycle(all: ObjectType[], typeId: string, parentTypeId: string | undefined): boolean {
  if (!parentTypeId) return false;
  if (parentTypeId === typeId) return true;
  const seen = new Set<string>();
  let cur: string | undefined = parentTypeId;
  while (cur) {
    if (cur === typeId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = all.find((t) => t.id === cur)?.parentTypeId;
  }
  return false;
}

function mergeBehaviors(chain: ObjectType[]): BehaviorInstance[] {
  const map = new Map<BehaviorId, BehaviorInstance>();
  for (const t of chain) {
    for (const b of t.behaviors ?? []) {
      if (!BEHAVIOR_IDS.includes(b.id)) continue;
      const prev = map.get(b.id);
      const def = BEHAVIORS[b.id];
      map.set(b.id, {
        id: b.id,
        enabled: b.enabled,
        settings: coerceProps(def.props, { ...(prev?.settings ?? {}), ...(b.settings ?? {}) }),
      });
    }
  }
  return Array.from(map.values());
}

/** Разрешает тип вместе с наследованием: свойства и поведения сливаются от корня к потомку. */
export function resolveType(typeId: string, all: ObjectType[]): ResolvedType | null {
  const chain = typeChain(typeId, all);
  if (!chain.length) return null;
  const list = chain.map((id) => all.find((t) => t.id === id)).filter((t): t is ObjectType => !!t);
  if (!list.length) return null;
  const leaf = list[list.length - 1];
  const props: PropValues = {};
  for (const t of list) Object.assign(props, t.props ?? {});
  return { type: leaf, chain, props, behaviors: mergeBehaviors(list) };
}

export function cloneType(t: ObjectType): ObjectType {
  return {
    ...t,
    props: { ...t.props },
    behaviors: t.behaviors.map((b) => ({ id: b.id, enabled: b.enabled, settings: { ...b.settings } })),
  };
}

/** Дефолтным типам поправляем запутанные названия (в старых проектах). */
const TYPE_RENAMES: Record<string, { name: string; desc: string }> = {
  type_player: {
    name: 'Мех игрока (спавн)',
    desc: 'Точка, где в превью появится мех игрока, и источник его настроек. Роль «Управляемый мех» — кем играешь, тип — откуда он появляется.',
  },
  type_reserve_mech: {
    name: 'Резервный мех (точка пересадки)',
    desc: 'Точка пересадки: после гибели первого меха сюда пересядет пилот. Роль «Запасной мех» — кем играешь этим объектом.',
  },
};

export function normalizeType(t: ObjectType, all: ObjectType[]): ObjectType {
  const rename = TYPE_RENAMES[t.id];
  const renamed = rename && (t.name === 'Мех игрока' || t.name === 'Резервный мех')
    ? { name: rename.name, desc: rename.desc }
    : {};
  const chain = t.parentTypeId && all.some((x) => x.id === t.parentTypeId) && !wouldCycle(all, t.id, t.parentTypeId)
    ? t.parentTypeId
    : undefined;
  const behaviors = (t.behaviors ?? [])
    .filter((b) => BEHAVIOR_IDS.includes(b.id))
    .map((b) => ({ id: b.id, enabled: !!b.enabled, settings: coerceProps(BEHAVIORS[b.id].props, b.settings) }));
  const seen = new Set<BehaviorId>();
  return {
    ...t,
    ...renamed,
    parentTypeId: chain,
    category: t.category ?? 'prop',
    role: t.role ?? 'neutral',
    behaviors: behaviors.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true))),
  };
}

export function findByRole(all: ObjectType[], role: Role): ObjectType | undefined {
  return all.find((t) => t.role === role && t.category === 'mech') ?? all.find((t) => t.role === role);
}

export function findByCategory(all: ObjectType[], category: TypeCategory): ObjectType | undefined {
  return all.find((t) => t.category === category && !t.parentTypeId);
}

export function typesUsing(all: ObjectType[], typeId: string): ObjectType[] {
  return all.filter((t) => t.parentTypeId === typeId || t.id === typeId);
}