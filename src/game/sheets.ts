import { BOOL, ENUM, NUM, TEXT, coerceProps, defaultValues, type PropDef, type PropValues } from './props.ts';
import type { ActionSpec, ConditionSpec, EventRow } from './project.ts';

export interface EntryDef {
  id: string;
  label: string;
  color: 'event' | 'object' | 'action' | 'system';
  params: PropDef[];
  category: string;
  hint?: string;
}

const OPS = ['=', '!=', '<', '<=', '>', '>='];

const byId = (list: EntryDef[]) => new Map(list.map((d) => [d.id, d]));

const P = {
  text: (key: string, label: string, def = '') => TEXT(key, label, def),
  num: (key: string, label: string, def = 0, min = 0, max = 99999, step = 1) => NUM(key, label, def, min, max, step),
  bool: (key: string, label: string, def = false) => BOOL(key, label, def),
  enu: (key: string, label: string, def: string, options: string[] = []) => ENUM(key, label, def, options),
};

export const EVENT_DEFS: EntryDef[] = [
  { id: 'on_spawn', label: 'При появлении', color: 'event', category: 'Объект', params: [] },
  { id: 'on_update', label: 'Каждый кадр', color: 'event', category: 'Объект', params: [P.bool('continuous', 'Проверять постоянно')] },
  { id: 'on_key', label: 'Нажата клавиша', color: 'event', category: 'Объект', params: [P.text('key', 'Клавиша')] },
  { id: 'on_collision', label: 'Столкновение', color: 'event', category: 'Объект', params: [P.text('other', 'С чем столкнулся')] },
  { id: 'on_damaged', label: 'Получил урон', color: 'event', category: 'Объект', params: [P.num('minDamage', 'Мин. урон')] },
  { id: 'on_destroyed', label: 'Уничтожен', color: 'event', category: 'Объект', params: [] },
  { id: 'on_timer', label: 'По таймеру', color: 'event', category: 'Система', hint: 'Срабатывает через заданный интервал', params: [P.num('interval', 'Интервал, с', 1, 0.05, 60, 0.05)] },
  { id: 'on_wave_started', label: 'Началась волна', color: 'event', category: 'Система', params: [P.num('index', 'Номер волны')] },
  { id: 'on_enemy_killed', label: 'Убит враг', color: 'event', category: 'Система', params: [] },
  { id: 'on_pilot_enter', label: 'Пилот сел', color: 'event', category: 'Мех', params: [] },
  { id: 'on_pilot_exit', label: 'Пилот вышел', color: 'event', category: 'Мех', params: [] },
  { id: 'on_overheat', label: 'Перегрев', color: 'event', category: 'Мех', params: [] },
];

export const CONDITION_DEFS: EntryDef[] = [
  { id: 'compare', label: 'Сравнить', color: 'system', category: 'Объект', params: [
    P.text('left', 'Слева'), P.enu('op', 'Оператор', '=', OPS), P.text('right', 'Справа'),
  ] },
  { id: 'distance', label: 'Дистанция', color: 'system', category: 'Объект', params: [
    P.text('target', 'Цель'), P.enu('op', 'Оператор', '<', OPS), P.num('value', 'Расстояние, м', 10, 0, 1000),
  ] },
  { id: 'in_state', label: 'Состояние', color: 'system', category: 'Объект', params: [P.enu('state', 'Состояние', 'patrol', ['idle', 'patrol', 'chase', 'attack', 'boarding'])] },
  { id: 'cooldown', label: 'Готовность', color: 'system', category: 'Объект', hint: 'Действия не повторятся чаще указанного интервала', params: [P.num('interval', 'Интервал, с', 1, 0.05, 30, 0.05)] },
  { id: 'random', label: 'Случай', color: 'system', category: 'Объект', params: [P.num('chance', 'Вероятность, %', 50, 0, 100)] },
  { id: 'is_pilot', label: 'Пилот внутри', color: 'system', category: 'Мех', params: [P.bool('value', 'Пилот внутри')] },
  { id: 'every_seconds', label: 'Каждые X секунд', color: 'system', category: 'Система', hint: 'Выполнение действий через регулярные промежутки времени', params: [P.num('seconds', 'Интервал, с', 1, 0.05, 60, 0.05)] },
  { id: 'compare_time', label: 'Сравнить время', color: 'system', category: 'Система', params: [
    P.num('left', 'Слева, с', 0, 0, 100000, 0.1), P.enu('op', 'Оператор', '=', OPS), P.num('right', 'Справа, с', 0, 0, 100000, 0.1),
  ] },
  { id: 'var_compare', label: 'Сравнить переменную', color: 'system', category: 'Система', params: [
    P.text('name', 'Переменная'), P.enu('op', 'Оператор', '=', OPS), P.num('value', 'Значение', 0, -1000000, 1000000, 1),
  ] },
  { id: 'var_exists', label: 'Есть переменная', color: 'system', category: 'Система', params: [P.text('name', 'Переменная')] },
  { id: 'pick_all', label: 'Выбрать все', color: 'system', category: 'Система', hint: 'Выбор экземпляров: все объекты типа', params: [P.text('target', 'Тип объектов', 'prop')] },
  { id: 'pick_lowest', label: 'Выбрать по наименьшему значению', color: 'system', category: 'Система', params: [P.text('target', 'Тип объектов', 'prop'), P.text('property', 'По свойству', 'hp')] },
  { id: 'pick_highest', label: 'Выбрать по наибольшему значению', color: 'system', category: 'Система', params: [P.text('target', 'Тип объектов', 'prop'), P.text('property', 'По свойству', 'hp')] },
  { id: 'pick_random', label: 'Выбрать случайный', color: 'system', category: 'Система', params: [P.text('target', 'Тип объектов', 'prop')] },
  { id: 'pick_last', label: 'Выбрать последний созданный', color: 'system', category: 'Система', params: [P.text('target', 'Тип объектов', 'prop')] },
{ id: 'pick_nearest', label: 'Выбрать ближайший', color: 'system', category: 'Система', params: [P.text('target', 'Тип объектов', 'prop')] },
  { id: 'nearest_type', label: 'Дистанция до типа', color: 'system', category: 'Система', hint: 'Расстояние до ближайшего объекта указанного типа — для посадки в мех', params: [
    P.text('target', 'Тип объектов', 'reserve'), P.num('maxDistance', 'Макс. дистанция, м', 4, 0.1, 50, 0.5),
  ] },
  { id: 'has_enemies', label: 'Есть живые враги', color: 'system', category: 'Система', params: [P.text('target', 'Тип врагов', 'enemy')] },
];

export const ACTION_DEFS: EntryDef[] = [
  { id: 'set_variable', label: 'Задать переменную', color: 'system', category: 'Система', params: [
    P.text('name', 'Переменная'), P.num('value', 'Значение', 0, -1000000, 1000000, 1),
  ] },
  { id: 'add_variable', label: 'Изменить переменную', color: 'system', category: 'Система', params: [
    P.text('name', 'Переменная'), P.num('delta', 'На сколько', 1, -1000000, 1000000, 1),
  ] },
  { id: 'toggle_variable', label: 'Переключить переменную', color: 'system', category: 'Система', params: [P.text('name', 'Переменная')] },
  { id: 'wait', label: 'Ждать', color: 'system', category: 'Система', params: [P.num('seconds', 'Секунд', 1, 0.05, 60, 0.05)] },
  { id: 'start_wave', label: 'Запустить волну', color: 'object', category: 'Система', params: [
    P.text('index', 'Волна'), P.num('delay', 'Задержка, с', 5, 0, 60),
  ] },
  { id: 'end_game', label: 'Закончить игру', color: 'object', category: 'Система', params: [P.enu('result', 'Результат', 'won', ['won', 'lost'])] },
  { id: 'teleport', label: 'Телепорт', color: 'action', category: 'Система', params: [
    P.num('x', 'X'), P.num('y', 'Y'), P.num('z', 'Z'),
  ] },
  { id: 'log', label: 'Запись в журнал', color: 'system', category: 'Система', params: [P.text('text', 'Текст')] },
  { id: 'move_towards', label: 'Идти к точке', color: 'action', category: 'Объект', params: [
    P.text('target', 'Цель'), P.num('speed', 'Скорость', 5, 0, 40, 0.5),
  ] },
  { id: 'set_speed', label: 'Задать скорость', color: 'action', category: 'Объект', params: [P.num('speed', 'Скорость', 0, -40, 40, 0.5)] },
  { id: 'turn_to', label: 'Повернуться к цели', color: 'action', category: 'Объект', params: [P.text('target', 'Цель')] },
  { id: 'damage', label: 'Нанести урон', color: 'action', category: 'Объект', params: [
    P.text('target', 'Цель'), P.num('amount', 'Урон', 10, 0, 1000),
  ] },
  { id: 'destroy', label: 'Уничтожить', color: 'action', category: 'Объект', params: [P.text('target', 'Цель')] },
  { id: 'set_state', label: 'Сменить состояние', color: 'object', category: 'Объект', params: [
    P.enu('state', 'Состояние', 'idle', ['idle', 'patrol', 'chase', 'attack', 'boarding']),
  ] },
  { id: 'enable_behavior', label: 'Включить поведение', color: 'object', category: 'Объект', params: [
    P.text('behavior', 'Поведение'), P.bool('enabled', 'Включить'),
  ] },
  { id: 'fire', label: 'Стрелять из слота', color: 'action', category: 'Оружие', params: [P.enu('slot', 'Слот', '1', ['1', '2', '3', '4'])] },
  { id: 'reload', label: 'Перезарядить', color: 'action', category: 'Оружие', params: [P.enu('slot', 'Слот', '1', ['1', '2', '3', '4'])] },
  { id: 'switch_weapon', label: 'Сменить оружие', color: 'action', category: 'Оружие', params: [P.enu('slot', 'Слот', '2', ['1', '2', '3', '4'])] },
{ id: 'board', label: 'Сесть в мех', color: 'object', category: 'Мех', params: [P.text('target', 'Мех')] },
  { id: 'eject', label: 'Покинуть мех', color: 'object', category: 'Мех', params: [] },
  { id: 'spawn_pilot', label: 'Высадить пилота', color: 'object', category: 'Мех', hint: 'Создаёт персонажа рядом с мехом и переводит управление на него', params: [P.num('offset', 'Смещение, м', 3, 0.5, 20, 0.5)] },
  { id: 'walk_to', label: 'Идти пешком', color: 'action', category: 'Мех', params: [P.num('speed', 'Скорость, м/с', 4, 0, 12, 0.5)] },
  { id: 'set_camera', label: 'Сменить вид', color: 'action', category: 'Мех', params: [
    P.enu('view', 'Вид', 'third', ['cockpit', 'third', 'shoulder', 'tactical']),
  ] },
  { id: 'spawn_fx', label: 'Эффект', color: 'action', category: 'Эффекты', params: [
    P.enu('effect', 'Эффект', 'explosion', ['explosion', 'sparks', 'dust', 'ring', 'muzzle']),
    P.num('scale', 'Масштаб', 1, 0.1, 10, 0.1),
  ] },
{ id: 'play_sound', label: 'Проиграть звук', color: 'action', category: 'Звук', params: [P.text('event', 'Событие звука')] },
  { id: 'shake_camera', label: 'Тряска камеры', color: 'action', category: 'Эффекты', params: [P.num('amount', 'Сила, 0..1', 0.3, 0, 1, 0.05)] },
];

export const EVENT_BY_ID = byId(EVENT_DEFS);
export const CONDITION_BY_ID = byId(CONDITION_DEFS);
export const ACTION_BY_ID = byId(ACTION_DEFS);

export function groupByCategory(defs: EntryDef[]): { category: string; defs: EntryDef[] }[] {
  const map = new Map<string, EntryDef[]>();
  for (const d of defs) {
    if (!map.has(d.category)) map.set(d.category, []);
    map.get(d.category)!.push(d);
  }
  return Array.from(map.entries()).map(([category, list]) => ({ category, defs: list }));
}

export function eventLabel(id: string): string {
  return EVENT_BY_ID.get(id)?.label ?? id;
}
export function conditionLabel(id: string): string {
  return CONDITION_BY_ID.get(id)?.label ?? id;
}
export function actionLabel(id: string): string {
  return ACTION_BY_ID.get(id)?.label ?? id;
}

export function newCondition(id = 'compare'): ConditionSpec {
  const def = CONDITION_BY_ID.get(id);
  return { condition: id, params: defaultValues(def?.params ?? []) };
}

export function newAction(id = 'log'): ActionSpec {
  const def = ACTION_BY_ID.get(id);
  return { action: id, params: defaultValues(def?.params ?? []) };
}

export function normalizeAction(a: ActionSpec): ActionSpec {
  const def = ACTION_BY_ID.get(a.action);
  return { action: a.action, params: def ? coerceProps(def.params, a.params) : (a.params ?? {}) };
}

export function normalizeCondition(c: ConditionSpec): ConditionSpec {
  const def = CONDITION_BY_ID.get(c.condition);
  return { condition: c.condition, params: def ? coerceProps(def.params, c.params) : (c.params ?? {}) };
}

let rowSeq = 0;
export function newRow(event = 'on_spawn'): EventRow {
  rowSeq += 1;
  return {
    id: `row_${Date.now().toString(36)}${rowSeq.toString(36)}`,
    event,
    comment: '',
    condition: undefined,
    then: [],
    else: [],
    children: [],
  };
}

export function walkRows(rows: EventRow[], fn: (row: EventRow, parent: EventRow[] | null) => void, parent: EventRow[] | null = null) {
  for (const r of rows) {
    fn(r, parent);
    if (r.children?.length) walkRows(r.children, fn, r.children);
  }
}

export function findRow(rows: EventRow[], id: string): EventRow | null {
  let found: EventRow | null = null;
  walkRows(rows, (r) => { if (r.id === id) found = r; });
  return found;
}

function mapRows(rows: EventRow[], id: string, fn: (row: EventRow) => EventRow): EventRow[] {
  return rows.map((r) => {
    const next = r.id === id ? fn(r) : r;
    if (next.children?.length) return { ...next, children: mapRows(next.children, id, fn) };
    return next;
  });
}

export function updateRowIn(rows: EventRow[], id: string, patch: Partial<EventRow>): EventRow[] {
  return mapRows(rows, id, (r) => ({ ...r, ...patch, id: r.id }));
}

export function removeRowFrom(rows: EventRow[], id: string): EventRow[] {
  return rows
    .filter((r) => r.id !== id)
    .map((r) => (r.children?.length ? { ...r, children: removeRowFrom(r.children, id) } : r));
}

export function moveRow(rows: EventRow[], id: string, delta: number): EventRow[] {
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return rows;
  const target = idx + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(idx, 1);
  next.splice(target, 0, row);
  return next;
}

/** Сколько «строк» занимает событие: заголовок + условия + действия + разделитель. */
export function rowLineCount(row: EventRow): number {
  let n = 1;
  if (row.condition) n += 1 + row.then.length + (row.else.length ? 1 + row.else.length : 0);
  else n += row.then.length;
  n += 1;
  for (const c of row.children ?? []) n += rowLineCount(c);
  return n;
}

/** Номера строк для левой колонки, как в Construct 3. */
export function lineNumbers(rows: EventRow[]): { row: EventRow; line: number }[] {
  let line = 1;
  const out: { row: EventRow; line: number }[] = [];
  const push = (row: EventRow) => {
    out.push({ row, line });
    line += rowLineCount(row);
    for (const c of row.children ?? []) push(c);
  };
  for (const r of rows) push(r);
  return out;
}

export function sheetLineCount(rows: EventRow[]): number {
  return lineNumbers(rows).reduce((sum, cur) => sum + rowLineCount(cur.row), 0) || 1;
}

export function describeParams(params: PropValues): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === false || v === 0) continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join(', ');
}