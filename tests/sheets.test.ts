import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_BY_ID, ACTION_DEFS, CONDITION_BY_ID, CONDITION_DEFS, EVENT_BY_ID, EVENT_DEFS,
  describeParams, findRow, groupByCategory, lineNumbers, moveRow, newAction, newCondition, newRow,
  normalizeAction, normalizeCondition, removeRowFrom, rowLineCount, updateRowIn,
} from '../src/game/sheets.ts';
import { defaultSheets, migrateV1toV2, ensureProject } from '../src/game/project.ts';

test('каталоги событий, условий и действий непустые и уникальные', () => {
  for (const list of [EVENT_DEFS, CONDITION_DEFS, ACTION_DEFS]) {
    assert.ok(list.length > 5, 'каталог слишком мал');
    const ids = list.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, 'дубликаты id');
    for (const d of list) {
      assert.ok(d.label.length > 0);
      assert.ok(['event', 'object', 'action', 'system'].includes(d.color));
    }
  }
  assert.equal(EVENT_BY_ID.get('on_spawn')?.label, 'При появлении');
  assert.equal(ACTION_BY_ID.get('start_wave')?.label, 'Запустить волну');
  assert.equal(CONDITION_BY_ID.get('in_state')?.label, 'Состояние');
});

test('новые условия и действия получают валидные дефолтные параметры', () => {
  const a = newAction('start_wave');
  assert.equal(a.action, 'start_wave');
  assert.equal(a.params.delay, 5, 'задержка по умолчанию');
  const c = newCondition('distance');
  assert.equal(c.params.value, 10);
  const bad = normalizeAction({ action: 'start_wave', params: { delay: 'мусор' as never } });
  assert.equal(bad.params.delay, 5, 'мусор заменён дефолтом');
  assert.equal(normalizeCondition({ condition: 'compare', params: {} }).params.op, '=');
});

test('нумерация строк идёт по порядку, как в Construct 3', () => {
  const rows = [
    { ...newRow('on_spawn'), then: [newAction('log')] },
    { ...newRow('on_key'), then: [newAction('log'), newAction('teleport')] },
  ];
  const lines = lineNumbers(rows);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].line, 1);
  assert.equal(lines[1].line, 1 + rowLineCount(rows[0]));
  assert.ok(lines[1].line > lines[0].line, 'строки растут');
});

test('вложенные события учитываются в номерах строк и в поиске', () => {
  const child = newRow('on_destroyed');
  const parent = { ...newRow('on_collision'), then: [newAction('damage')], children: [child] };
  const lines = lineNumbers([parent]);
  assert.equal(lines.length, 2, 'родитель и ребёнок в списке');
  assert.ok(findRow([parent], child.id), 'ребёнок находится');
  assert.equal(lines[1].line, lines[0].line + rowLineCount(parent));

  const moved = moveRow([parent], child.id, 0);
  assert.equal(moved.length, 1, 'перемещение внутри дерева не ломает список');
  assert.ok(findRow(moved, child.id));
});

test('правка строки не ломает вложенность и id', () => {
  const child = newRow('on_timer');
  const parent = { ...newRow('on_spawn'), children: [child] };
  const patched = updateRowIn([parent], child.id, { event: 'on_overheat', comment: 'кипеть' });
  const found = findRow(patched, child.id);
  assert.equal(found?.event, 'on_overheat');
  assert.equal(found?.comment, 'кипеть');
  assert.equal(findRow(patched, parent.id)?.children.length, 1);
  const removed = removeRowFrom(patched, child.id);
  assert.equal(findRow(removed, child.id), null);
  assert.equal(findRow(removed, parent.id)?.children.length, 0);
});

test('moveRow двигает строку вверх и вниз и не выходит за границы', () => {
  const a = newRow('on_spawn');
  const b = newRow('on_key');
  const c = newRow('on_timer');
  const rows = [a, b, c];
  const down = moveRow(rows, a.id, 1);
  assert.equal(down[0].id, b.id);
  assert.equal(down[1].id, a.id);
  const up = moveRow(rows, c.id, -1);
  assert.equal(up[1].id, c.id);
  assert.deepEqual(moveRow(rows, a.id, -1), rows, 'вверх из начала — без изменений');
  assert.deepEqual(moveRow(rows, c.id, 1), rows, 'вниз за конец — без изменений');
});

test('удаление строки не трогает соседние', () => {
  const a = newRow('on_spawn');
  const b = newRow('on_key');
  const c = newRow('on_timer');
  const after = removeRowFrom([a, b, c], b.id);
  assert.deepEqual(after.map((r) => r.id), [a.id, c.id]);
});

test('условие с действиями и веткой «иначе» занимает больше строк', () => {
  const plain = { ...newRow('on_spawn'), then: [newAction('log')] };
  const withCond = {
    ...newRow('on_spawn'),
    condition: newCondition('compare'),
    then: [newAction('log')],
    else: [newAction('log')],
  };
  assert.ok(rowLineCount(withCond) > rowLineCount(plain));
});

test('готовые листы игры валидны и переживают миграцию', () => {
  const sheets = defaultSheets();
  assert.ok(sheets.length >= 2);
  const all = sheets.flatMap((s) => s.rows);
  assert.ok(all.length >= 6, 'в шаблоне должны быть собраны волны и пересадка');
  for (const row of all) {
    assert.ok(EVENT_BY_ID.has(row.event), `неизвестное событие ${row.event}`);
    assert.ok(Array.isArray(row.children), 'у события есть массив children');
    for (const a of row.then) assert.ok(ACTION_BY_ID.has(a.action), `неизвестное действие ${a.action}`);
    if (row.condition) assert.ok(CONDITION_BY_ID.has(row.condition.condition));
  }
  const migrated = migrateV1toV2({ objects: [] });
  assert.equal(migrated.sheets.length, sheets.length);
  assert.deepEqual(ensureProject(null).sheets.length, sheets.length);
});

test('каталоги разложены по категориям, включая системные', () => {
  const groups = groupByCategory(CONDITION_DEFS).map((g) => g.category);
  assert.ok(groups.includes('Система'), 'есть системные условия');
  assert.ok(groups.includes('Объект'));
  assert.ok(groups.includes('Мех'));
  assert.equal(groupByCategory(EVENT_DEFS).reduce((n, g) => n + g.defs.length, 0), EVENT_DEFS.length);
  assert.equal(groupByCategory(ACTION_DEFS).reduce((n, g) => n + g.defs.length, 0), ACTION_DEFS.length);
  for (const d of [...EVENT_DEFS, ...CONDITION_DEFS, ...ACTION_DEFS]) {
    assert.ok(d.category.length > 0, `${d.id} без категории`);
  }
});

test('системные условия покрывают время, переменные и выбор объектов', () => {
  for (const id of ['every_seconds', 'compare_time', 'var_compare', 'var_exists', 'pick_all', 'pick_lowest', 'pick_highest', 'pick_random', 'pick_last', 'pick_nearest']) {
    assert.ok(CONDITION_BY_ID.has(id), `нет системного условия ${id}`);
    assert.equal(CONDITION_BY_ID.get(id)?.category, 'Система');
  }
  assert.equal(CONDITION_BY_ID.get('every_seconds')?.hint, 'Выполнение действий через регулярные промежутки времени');
  assert.equal(newCondition('every_seconds').params.seconds, 1);
});

test('системные действия умеют менять переменные и ждать', () => {
  for (const id of ['set_variable', 'add_variable', 'toggle_variable', 'wait', 'start_wave', 'end_game', 'teleport', 'log']) {
    assert.ok(ACTION_BY_ID.has(id), `нет системного действия ${id}`);
    assert.equal(ACTION_BY_ID.get(id)?.category, 'Система');
  }
  assert.equal(newAction('set_variable').params.name, '');
  assert.equal(newAction('add_variable').params.delta, 1);
  const gun = newAction('fire');
  assert.equal(ACTION_BY_ID.get('fire')?.category, 'Оружие');
  assert.equal(gun.params.slot, '1');
  assert.equal(ACTION_BY_ID.get('spawn_fx')?.category, 'Эффекты');
  assert.equal(ACTION_BY_ID.get('play_sound')?.category, 'Звук');
});

test('логика пилота вынесена в лист событий', () => {
  const pilot = defaultSheets().find((s) => s.id === 'sheet_pilot');
  assert.ok(pilot, 'есть лист пилота');
  const events = pilot.rows.map((r) => r.event);
  assert.ok(events.includes('on_spawn'), 'пилот появляется');
  assert.ok(events.includes('on_key'), 'пилот реагирует на клавиши');
  assert.ok(events.includes('on_collision'), 'пилот может сесть при столкновении');
  assert.ok(events.includes('on_destroyed'), 'гибель пилота обработана');
  const board = pilot.rows.find((r) => r.event === 'on_key');
  assert.equal(board?.condition?.condition, 'nearest_type', 'посадка только рядом с резервом');
  assert.ok(board?.then.some((a) => a.action === 'board'));
  assert.ok(board?.else.some((a) => a.action === 'log'), 'есть ветка «иначе»');
  const update = pilot.rows.find((r) => r.event === 'on_update');
  assert.ok(update?.then.some((a) => a.action === 'walk_to'), 'пилот ходит');
});

test('листы покрывают меха, резервы, врагов, волны, пропы и мир', () => {
  const ids = defaultSheets().map((s) => s.id);
  for (const need of ['sheet_player_mech', 'sheet_reserve', 'sheet_enemies', 'sheet_waves', 'sheet_props', 'sheet_world']) {
    assert.ok(ids.includes(need), `нет листа ${need}`);
  }
  const byId = new Map(defaultSheets().map((s) => [s.id, s]));

  const reserve = byId.get('sheet_reserve')!;
  assert.ok(reserve.rows.some((r) => r.event === 'on_pilot_enter'), 'резерв реагирует на посадку пилота');
  assert.ok(reserve.rows.some((r) => r.event === 'on_pilot_exit'), 'резерв реагирует на выход пилота');

  const enemies = byId.get('sheet_enemies')!;
  assert.ok(enemies.rows.some((r) => r.then.some((a) => a.action === 'set_state')), 'враги меняют состояние');
  assert.ok(enemies.rows.some((r) => r.then.some((a) => a.action === 'fire')), 'враги стреляют');
  assert.ok(enemies.rows.some((r) => r.event === 'on_destroyed' && r.then.some((a) => a.action === 'add_variable')), 'счётчик убийств');

  const waves = byId.get('sheet_waves')!;
  assert.ok(waves.rows.some((r) => r.then.some((a) => a.action === 'start_wave')));
  assert.ok(waves.rows.some((r) => r.then.some((a) => a.action === 'end_game')), 'победа и поражение в листах');

  const props = byId.get('sheet_props')!;
  assert.ok(props.rows.some((r) => r.then.some((a) => a.action === 'spawn_fx')), 'взрывы бочек в листах');
  assert.ok(props.rows.some((r) => r.else.length > 0), 'у пропов есть ветвление');

  const player = byId.get('sheet_player_mech')!;
  assert.ok(player.rows.some((r) => r.then.some((a) => a.action === 'spawn_pilot')), 'выход пилота из меха');
  assert.ok(ACTION_BY_ID.has('eject'), 'действие «Покинуть мех» доступно в каталоге');
  assert.equal(ACTION_BY_ID.get('spawn_pilot')?.category, 'Мех');
});

test('в листах шаблона нет неизвестных событий, условий и действий', () => {
  const check = (rows: typeof defaultSheets extends () => infer R ? R extends { rows: infer X }[] ? X : never : never) => {
    for (const row of rows) {
      assert.ok(EVENT_BY_ID.has(row.event), `неизвестное событие ${row.event}`);
      if (row.condition) assert.ok(CONDITION_BY_ID.has(row.condition.condition), `неизвестное условие ${row.condition.condition}`);
      for (const branch of [row.then, row.else]) {
        for (const a of branch) assert.ok(ACTION_BY_ID.has(a.action), `неизвестное действие ${a.action}`);
      }
      if (row.children?.length) check(row.children);
    }
  };
  for (const sheet of defaultSheets()) check(sheet.rows);
});

test('описание параметров скрывает пустые значения', () => {
  const text = describeParams({ name: 'волна', delay: 5, flag: false, target: '' });
  assert.equal(text, 'name: волна, delay: 5');
});