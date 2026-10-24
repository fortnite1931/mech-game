/**
 * Игровые системы игрока: предметы, лут, рецепты крафта.
 * Всё описано данными, чтобы редактор мог менять без правки кода.
 */

export type ItemId =
  | 'scrap' | 'plate' | 'gear' | 'hydraulic' | 'reactor' | 'cockpit_core' | 'fuel_cell'
  | 'medkit' | 'ammo_shells' | 'raremetal';

export interface ItemDef {
  id: ItemId;
  name: string;
  short: string;
  desc: string;
  /** Вес одной штуки — влияет на вместимость инвентаря. */
  weight: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  scrap: { id: 'scrap', name: 'Лом', short: 'ЛОМ', desc: 'Ржавый металлолом. Базовое сырьё для крафта.', weight: 1 },
  plate: { id: 'plate', name: 'Броневой лист', short: 'БРОНЯ', desc: 'Прочная сталь в бронежилетах меха.', weight: 3 },
  gear: { id: 'gear', name: 'Редуктор', short: 'РЕДУКТОР', desc: 'Шестерни привода ног.', weight: 2 },
  hydraulic: { id: 'hydraulic', name: 'Гидроцилиндр', short: 'ГИДРО', desc: 'Привод наклона корпуса и рук.', weight: 4 },
  reactor: { id: 'reactor', name: 'Реактор', short: 'РЕАКТОР', desc: 'Ядро энергоблока. Без него мех не поедет.', weight: 12 },
  cockpit_core: { id: 'cockpit_core', name: 'Кабина', short: 'КАБИНА', desc: 'Кресло пилота с интерфейсами.', weight: 10 },
  fuel_cell: { id: 'fuel_cell', name: 'Топливный элемент', short: 'ТОПЛИВО', desc: 'Джет-топливо. Даёт форсаж форсажных рам.', weight: 5 },
  medkit: { id: 'medkit', name: 'Аптечка', short: 'АПТЕЧКА', desc: 'Восстанавливает здоровье на 40.', weight: 1 },
  ammo_shells: { id: 'ammo_shells', name: 'Боезапас', short: 'БОЕЗАПАС', desc: 'Снаряды к автопушке.', weight: 2 },
  raremetal: { id: 'raremetal', name: 'Редкий металл', short: 'РЕДМЕТАЛЛ', desc: 'Тяжёлый сплав из глубин. Нужен для «Титана».', weight: 6 },
};

export type LootTableId = 'junk' | 'military' | 'industrial' | 'rare';

export interface LootEntry {
  item: ItemId;
  min: number;
  max: number;
  chance: number;
}

export interface LootTable {
  id: LootTableId | string;
  name: string;
  /** true — детали с разобранного врага, false — с мусора на карте. */
  salvage?: boolean;
  enabled?: boolean;
  /** Какие объекты при разрушении дают этот стол. */
  from: string[];
  entries: LootEntry[];
}

export const LOOT_TABLES: LootTable[] = [
  {
    id: 'junk', name: 'Хлам (ящики, мусор)',
    from: ['crate', 'tires', 'car_wreck', 'scrap', 'bricks'],
    entries: [
      { item: 'scrap', min: 1, max: 3, chance: 0.9 },
      { item: 'plate', min: 1, max: 1, chance: 0.25 },
      { item: 'ammo_shells', min: 1, max: 2, chance: 0.2 },
    ],
  },
  {
    id: 'industrial', name: 'Промышленный (бочки, контейнеры)',
    from: ['barrel', 'barrel_group', 'barrel_toxic', 'container', 'girder', 'rails'],
    entries: [
      { item: 'scrap', min: 2, max: 5, chance: 0.95 },
      { item: 'plate', min: 1, max: 2, chance: 0.45 },
      { item: 'gear', min: 1, max: 1, chance: 0.22 },
      { item: 'medkit', min: 1, max: 1, chance: 0.12 },
    ],
  },
  {
    id: 'military', name: 'Военный (турели, техника)',
    from: ['turret', 'watchtower', 'outpost', 'generator'],
    entries: [
      { item: 'ammo_shells', min: 2, max: 6, chance: 0.8 },
      { item: 'plate', min: 1, max: 2, chance: 0.5 },
      { item: 'hydraulic', min: 1, max: 1, chance: 0.3 },
      { item: 'fuel_cell', min: 1, max: 1, chance: 0.25 },
      { item: 'medkit', min: 1, max: 1, chance: 0.3 },
    ],
  },
  {
    id: 'rare', name: 'Редкий (лаборатории, купол)',
    from: ['dome', 'antenna', 'checkpoint', 'bunker_wall'],
    entries: [
      { item: 'raremetal', min: 1, max: 2, chance: 0.35 },
      { item: 'reactor', min: 1, max: 1, chance: 0.18 },
      { item: 'cockpit_core', min: 1, max: 1, chance: 0.15 },
      { item: 'fuel_cell', min: 1, max: 2, chance: 0.3 },
    ],
  },
  // --- разобранные машины: источник дефицитных деталей для крафта ---
  {
    id: 'salvage_scout', name: 'Разбор: «Ястреб»', salvage: true,
    from: ['mech_scout'],
    entries: [
      { item: 'scrap', min: 6, max: 10, chance: 1 },
      { item: 'plate', min: 3, max: 5, chance: 1 },
      { item: 'gear', min: 2, max: 3, chance: 0.85 },
      { item: 'ammo_shells', min: 2, max: 4, chance: 0.5 },
      { item: 'cockpit_core', min: 1, max: 1, chance: 0.22 },
    ],
  },
  {
    id: 'salvage_molot', name: 'Разбор: «Молот»', salvage: true,
    from: ['mech_molot'],
    entries: [
      { item: 'scrap', min: 10, max: 14, chance: 1 },
      { item: 'plate', min: 6, max: 9, chance: 1 },
      { item: 'gear', min: 2, max: 4, chance: 0.9 },
      { item: 'hydraulic', min: 2, max: 3, chance: 0.8 },
      { item: 'fuel_cell', min: 1, max: 2, chance: 0.45 },
      { item: 'cockpit_core', min: 1, max: 1, chance: 0.3 },
    ],
  },
  {
    id: 'salvage_titan', name: 'Разбор: «Титан»', salvage: true,
    from: ['mech_juggernaut'],
    entries: [
      { item: 'scrap', min: 14, max: 20, chance: 1 },
      { item: 'plate', min: 10, max: 14, chance: 1 },
      { item: 'raremetal', min: 2, max: 4, chance: 0.9 },
      { item: 'hydraulic', min: 3, max: 5, chance: 0.85 },
      { item: 'reactor', min: 1, max: 1, chance: 0.55 },
      { item: 'cockpit_core', min: 1, max: 1, chance: 0.4 },
      { item: 'fuel_cell', min: 2, max: 3, chance: 0.6 },
    ],
  },
  {
    id: 'salvage_infantry', name: 'Разбор: пехота', salvage: true,
    from: ['pilot_human', 'survivor'],
    entries: [
      { item: 'scrap', min: 2, max: 4, chance: 0.9 },
      { item: 'plate', min: 1, max: 2, chance: 0.6 },
      { item: 'ammo_shells', min: 1, max: 3, chance: 0.7 },
      { item: 'medkit', min: 1, max: 1, chance: 0.18 },
    ],
  },
];

export interface RecipePart { item: ItemId; count: number }

export interface Recipe {
  id: string;
  name: string;
  /** Какой мех собираем. */
  chassis: string;
  parts: RecipePart[];
  /** Сколько крафтов доступно за игру (0 — бесконечно). */
  limit: number;
  desc: string;
}

export const RECIPES: Recipe[] = [
  {
    id: 'craft_scout', name: 'Собрать «Ястреб»', chassis: 'mech_scout', limit: 0,
    desc: 'Лёгкий разведчик: лом, броня, редуктор, кабина.',
    parts: [
      { item: 'scrap', count: 12 }, { item: 'plate', count: 6 },
      { item: 'gear', count: 3 }, { item: 'cockpit_core', count: 1 },
    ],
  },
  {
    id: 'craft_molot', name: 'Собрать «Молот»', chassis: 'mech_molot', limit: 0,
    desc: 'Штурмовик: больше брони и гидроцилиндров.',
    parts: [
      { item: 'scrap', count: 20 }, { item: 'plate', count: 12 },
      { item: 'gear', count: 4 }, { item: 'hydraulic', count: 3 },
      { item: 'reactor', count: 1 }, { item: 'cockpit_core', count: 1 },
    ],
  },
  {
    id: 'craft_titan', name: 'Собрать «Титан»', chassis: 'mech_juggernaut', limit: 0,
    desc: 'Джаггернаут: тяжёлый, нужен редкий металл.',
    parts: [
      { item: 'scrap', count: 35 }, { item: 'plate', count: 20 },
      { item: 'gear', count: 8 }, { item: 'hydraulic', count: 6 },
      { item: 'raremetal', count: 6 }, { item: 'reactor', count: 2 },
      { item: 'cockpit_core', count: 1 }, { item: 'fuel_cell', count: 2 },
    ],
  },
];

/** Инвентарь: количество предметов + переполнение. */
export class Inventory {
  private items = new Map<ItemId, number>();
  // без TS-параметра в конструкторе: node --test не умеет strip-only такой синтаксис
  private capacityWeight: number;
  constructor(capacityWeight: number) { this.capacityWeight = capacityWeight; }

  setCapacity(kg: number) { this.capacityWeight = kg; }
  weight(): number {
    let w = 0;
    this.items.forEach((n, id) => { w += n * ITEMS[id].weight; });
    return w;
  }
  free(): number { return Math.max(0, this.capacityWeight - this.weight()); }
  /** Возвращает сколько реально влезло. */
  add(id: ItemId, count: number): number {
    const per = ITEMS[id].weight || 1;
    const room = Math.floor(this.free() / per);
    const taken = Math.max(0, Math.min(count, room));
    if (taken) this.items.set(id, (this.items.get(id) ?? 0) + taken);
    return taken;
  }
  take(id: ItemId, count: number): boolean {
    const have = this.items.get(id) ?? 0;
    if (have < count) return false;
    if (have === count) this.items.delete(id);
    else this.items.set(id, have - count);
    return true;
  }
  count(id: ItemId): number { return this.items.get(id) ?? 0; }
  entries(): { item: ItemId; n: number }[] {
    return [...this.items.entries()].map(([item, n]) => ({ item, n })).sort((a, b) => b.n - a.n);
  }
  total(): number { let n = 0; this.items.forEach((v) => { n += v; }); return n; }
  clear() { this.items.clear(); }
}

/**
 * Бросок стола лута. Таблицы берём из проекта (их можно править в редакторе),
 * поэтому всё определяется данными, а не кодом.
 * multiplier > 1 — щедрее (например, режим «трофей»).
 */
export function rollLoot(
  assetId: string,
  opts: { tables?: LootTable[]; multiplier?: number; salvageOnly?: boolean; rng?: () => number } = {},
): ItemId[] {
  const { tables = LOOT_TABLES, multiplier = 1, salvageOnly = false, rng = Math.random } = opts;
  const out: ItemId[] = [];
  for (const table of tables) {
    if (table.enabled === false) continue;
    if (!!table.salvage !== salvageOnly) continue;
    if (!table.from.includes(assetId)) continue;
    for (const e of table.entries) {
      // множитель поднимает шанс, но не выше 1
      if (rng() > Math.min(1, e.chance * multiplier)) continue;
      const n = e.min + Math.floor(rng() * Math.max(1, e.max - e.min + 1));
      const count = Math.max(0, Math.round(n * Math.min(2, multiplier)));
      for (let i = 0; i < count; i++) out.push(e.item);
    }
    if (out.length) break;
  }
  return out;
}

/** Привести таблицы проекта к валидному виду (после загрузки файла). */
export function normalizeLoot(raw: unknown): LootTable[] {
  const isItem = (v: unknown): v is ItemId => typeof v === 'string' && v in ITEMS;
  if (!Array.isArray(raw)) return LOOT_TABLES.map((t) => ({ ...t, entries: t.entries.map((e) => ({ ...e })) }));
  const list = raw.filter((t): t is LootTable => !!t && typeof t === 'object' && Array.isArray((t as LootTable).entries));
  if (!list.length) return LOOT_TABLES.map((t) => ({ ...t, entries: t.entries.map((e) => ({ ...e })) }));
  return list.map((t) => ({
    id: String(t.id ?? t.name ?? 'table'),
    name: String(t.name ?? t.id ?? 'Стол'),
    salvage: !!t.salvage,
    enabled: t.enabled !== false,
    from: Array.isArray(t.from) ? t.from.map(String) : [],
    entries: t.entries
      .filter((e) => e && isItem(e.item))
      .map((e) => ({
        item: e.item,
        min: Math.max(0, Math.round(Number(e.min) || 0)),
        max: Math.max(Number(e.min) || 0, Math.round(Number(e.max) || 0)),
        chance: Math.min(1, Math.max(0, Number(e.chance) || 0)),
      })),
  }));
}

/** Привести рецепты проекта к валидному виду. */
export function normalizeCraft(raw: unknown): Recipe[] {
  const isItem = (v: unknown): v is ItemId => typeof v === 'string' && v in ITEMS;
  if (!Array.isArray(raw)) return RECIPES.map((r) => ({ ...r, parts: r.parts.map((p) => ({ ...p })) }));
  const list = raw.filter((r): r is Recipe => !!r && typeof r === 'object' && Array.isArray((r as Recipe).parts));
  if (!list.length) return RECIPES.map((r) => ({ ...r, parts: r.parts.map((p) => ({ ...p })) }));
  return list.map((r, i) => ({
    id: String(r.id ?? `recipe_${i}`),
    name: String(r.name ?? 'Рецепт'),
    chassis: typeof r.chassis === 'string' ? r.chassis : 'mech_scout',
    limit: Math.max(0, Math.round(Number(r.limit) || 0)),
    desc: typeof r.desc === 'string' ? r.desc : '',
    parts: r.parts
      .filter((p) => p && isItem(p.item))
      .map((p) => ({ item: p.item, count: Math.max(1, Math.round(Number(p.count) || 1)) })),
  }));
}

/** Хватает ли деталей на рецепт. */
export function canCraft(inv: Inventory, recipe: Recipe): boolean {
  return recipe.parts.every((p) => inv.count(p.item) >= p.count);
}

/** Списать детали и вернуть chassis. */
export function craft(inv: Inventory, recipe: Recipe): string | null {
  if (!canCraft(inv, recipe)) return null;
  recipe.parts.forEach((p) => inv.take(p.item, p.count));
  return recipe.chassis;
}
