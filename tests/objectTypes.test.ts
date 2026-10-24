import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampNumber, coerceProp, coerceProps, defaultValues, groupDefs, mergePropValues,
  NUM, BOOL, ENUM, COLOR,
} from '../src/game/props.ts';
import {
  BEHAVIORS, BEHAVIOR_IDS, behaviorDef, behaviorDefaults,
} from '../src/game/behaviors.ts';
import {
  wouldCycle, resolveType, makeType, cloneType, normalizeType, typeChain,
  findByRole, typesUsing, defaultBehaviorsFor,
} from '../src/game/types.ts';
import {
  defaultTypes, migrateV1toV2, ensureProject, emptyProject, PROJECT_VERSION,
} from '../src/game/project.ts';
import { DEFAULT_MECH_CONFIG } from '../src/three/playTypes.ts';

test('свойства чинят мусорные значения и уважают границы', () => {
  const def = NUM('hp', 'Прочность', 100, 10, 500, 5);
  assert.equal(coerceProp(def, 50), 50);
  assert.equal(coerceProp(def, '250'), 250);
  assert.equal(coerceProp(def, 9999), 500, 'верхняя граница');
  assert.equal(coerceProp(def, -50), 10, 'нижняя граница');
  assert.equal(coerceProp(def, 'мусор'), 100, 'fallback на дефолт');
  assert.equal(clampNumber(Number.NaN, def), 100);
  assert.equal(coerceProp(BOOL('f', 'Ф', true), 'true'), true);
  assert.equal(coerceProp(BOOL('f', 'Ф', true), 'нет'), false);
  assert.equal(coerceProp(ENUM('e', 'Е', 'a', ['a', 'b']), 'b'), 'b');
  assert.equal(coerceProp(ENUM('e', 'Е', 'a', ['a', 'b']), 'zzz'), 'a', 'неизвестный вариант -> дефолт');
  assert.equal(coerceProp(COLOR('c', 'Ц', '#fff'), '#7cf5b0'), '#7cf5b0');
  assert.equal(coerceProp(COLOR('c', 'Ц', '#fff'), 'red'), '#fff');
});

test('coerceProps отбрасывает лишние ключи и добивает недостающие', () => {
  const defs = [NUM('a', 'A', 1, 0, 10, 1), BOOL('b', 'B', true)];
  const out = coerceProps(defs, { a: 5, b: false, мусор: 1 });
  assert.deepEqual(out, { a: 5, b: false });
  assert.deepEqual(coerceProps(defs, null), { a: 1, b: true });
  assert.deepEqual(defaultValues(defs), { a: 1, b: true });
  assert.deepEqual(mergePropValues({ a: 1 }, { b: true }), { a: 1, b: true });
  assert.deepEqual(groupDefs(defs)[0].defs.length, 2);
});

test('все поведения описаны и их настройки приводятся к валидным', () => {
  assert.equal(BEHAVIOR_IDS.length, 10);
  for (const id of BEHAVIOR_IDS) {
    const def = BEHAVIORS[id];
    assert.ok(def.props.length > 0, `${id} без настроек`);
    const vals = coerceProps(def.props, { мусор: 1 });
    assert.equal(Object.keys(vals).length, def.props.length);
    for (const p of def.props) assert.notEqual(vals[p.key], undefined, `${id}.${p.key} пусто`);
  }
  assert.equal(behaviorDef('movement')?.name, 'Движение');
  assert.equal(behaviorDef('нет такого'), undefined);
  assert.deepEqual(Object.keys(behaviorDefaults('ai_turret')).sort(), BEHAVIORS.ai_turret.props.map((p) => p.key).sort());
});

test('наследование сливает свойства и поведения от корня к потомку', () => {
  const base = makeType({ id: 'base', name: 'База', category: 'mech', props: { chassis: 'a', tonnage: 10 } });
  const child = makeType({
    id: 'child', name: 'Потомок', category: 'mech', parentTypeId: 'base',
    props: { tonnage: 99 },
    behaviors: [{ id: 'movement', enabled: true, settings: { maxSpeed: 88 } }],
  });
  const res = resolveType('child', [base, child]);
  assert.ok(res);
  assert.deepEqual(res.chain, ['base', 'child']);
  assert.equal(res.props.chassis, 'a', 'свойство родителя наследуется');
  assert.equal(res.props.tonnage, 99, 'свойство потомка перекрывает');
  const mv = res.behaviors.find((b) => b.id === 'movement');
  assert.equal(mv?.settings.maxSpeed, 88);
  assert.equal(resolveType('нет-такого', [base]), null);
});

test('настройки родителя не теряются при частичном переопределении', () => {
  const base = makeType({
    id: 'base', name: 'База', category: 'mech',
    behaviors: [{ id: 'movement', enabled: true, settings: { maxSpeed: 40, accel: 0.8 } }],
  });
  const child = makeType({
    id: 'child', name: 'Потомок', category: 'mech', parentTypeId: 'base',
    behaviors: [{ id: 'movement', enabled: true, settings: { maxSpeed: 55 } }],
  });
  const mv = resolveType('child', [base, child])!.behaviors.find((b) => b.id === 'movement');
  assert.equal(mv?.settings.maxSpeed, 55, 'перекрыто потомком');
  assert.equal(mv?.settings.accel, 0.8, 'остальное от родителя');
});

test('зацикливание наследования ловится и не роняет разрешение', () => {
  const a = makeType({ id: 'a', name: 'A', category: 'mech' });
  const b = makeType({ id: 'b', name: 'B', category: 'mech', parentTypeId: 'a' });
assert.equal(wouldCycle([a, b], 'a', 'b'), true, 'a<-b<-a это цикл');
assert.equal(wouldCycle([a, b], 'b', 'a'), false, 'a<-b это обычное наследование');
assert.equal(wouldCycle([a, b], 'a', 'a'), true, 'родитель сам себе');
  assert.equal(wouldCycle([a, b], 'a', undefined), false);
  assert.deepEqual(typeChain('b', [a, b]), ['a', 'b']);
  const orphan = normalizeType(makeType({ id: 'c', name: 'C', category: 'mech', parentTypeId: 'нет-такого' }), [a, b]);
  assert.equal(orphan.parentTypeId, undefined, 'несуществующий родитель отбрасывается');
  const selfParent = normalizeType({ ...a, parentTypeId: 'a' }, [a]);
  assert.equal(selfParent.parentTypeId, undefined, 'родитель-сам-себя отбрасывается');
  assert.doesNotThrow(() => resolveType('b', [a, b]));
});

test('типы ролей и поиск находятся корректно', () => {
  const types = defaultTypes();
  const player = findByRole(types, 'player');
  assert.equal(player?.id, 'type_player');
  assert.equal(findByRole(types, 'enemy')?.id, 'type_mech_scout');
  assert.equal(findByRole(types, 'reserve')?.id, 'type_reserve_mech');
  const users = typesUsing(types, 'type_mech');
  assert.ok(users.length >= 5, 'все шасси наследуют базовый «Мех»');
  assert.equal(types.every((t) => t.role === 'player' || t.role === 'enemy' || t.role === 'reserve' || t.role === 'neutral'), true);
  assert.deepEqual(defaultBehaviorsFor('prop'), ['prop_physics', 'destroyable']);
});

test('cloneType не делит ссылки с оригиналом', () => {
  const t = defaultTypes()[1];
  const c = cloneType(t);
  c.props.tires = 99;
  c.behaviors[0].settings.maxSpeed = 1;
  assert.notEqual(t.props.tires, 99);
  assert.notEqual(t.behaviors[0].settings.maxSpeed, 1);
});

test('тип «Пилот» существует: ходьба, живучесть, посадка в мех', () => {
  const types = defaultTypes();
  const pilot = types.find((t) => t.id === 'type_pilot');
  assert.ok(pilot, 'тип пилота должен быть в шаблоне');
  assert.equal(pilot.category, 'pilot');
  assert.equal(pilot.role, 'neutral');
  const ids = pilot.behaviors.map((b) => b.id);
  assert.ok(ids.includes('movement'), 'пилот умеет ходить');
  assert.ok(ids.includes('pilot'), 'у пилота есть посадка в мех');
  assert.ok(ids.includes('survivability'), 'у пилота есть прочность');
  const movement = pilot.behaviors.find((b) => b.id === 'movement')!;
  assert.equal(movement.settings.jumpJets, false, 'пилот не прыгает на джетах');
  assert.ok(Number(movement.settings.maxSpeed) > 0);
});

test('миграция v1 поднимает старую сцену в проект v2 без потерь', () => {
  const types = defaultTypes();
  const player = findByRole(types, 'player');
  const pilot = types.find((t) => t.id === 'type_pilot');
  assert.notEqual(player?.id, pilot?.id);
  assert.equal(player?.category, 'mech');
  assert.equal(pilot?.category, 'pilot');
});

test('миграция v1 поднимает старую сцену в проект v2 без потерь', () => {
  const v1 = {
    environment: { fogDensity: 0.02, grid: false },
    player: { ...DEFAULT_MECH_CONFIG, chassis: 'mech_juggernaut' },
    scenario: { playerHp: 500, enemyHpMul: 2, enemyDmgMul: 1, waves: [] },
    world: { seed: 1234 },
    objects: [
      { id: 'obj_1', name: 'Ястреб', assetId: 'mech_scout', role: 'enemy' },
      { id: 'obj_2', name: 'Точка', assetId: 'mech_juggernaut', role: 'spawn' },
      { id: 'obj_3', name: 'Бочка', assetId: 'barrel', role: 'prop' },
      { id: 'obj_4', name: 'Турель', assetId: 'turret', role: 'enemy' },
    ],
  };
  const p = migrateV1toV2(v1);
  assert.equal(p.meta.version, PROJECT_VERSION);
  assert.equal((p.player as { chassis: string }).chassis, 'mech_juggernaut', 'настройки пилота сохранены');
  assert.equal((p.scenario as { playerHp: number }).playerHp, 500, 'баланс сохранён');
  assert.equal((p.world as { seed: number }).seed, 1234);
  assert.equal(p.scene.length, 4);
  assert.equal(p.scene[0].typeId, 'type_mech_scout', 'враг-мех получил тип');
  assert.equal(p.scene[1].role, 'reserve', 'точка появления стала резервом');
  assert.equal(p.scene[2].role, 'neutral');
  assert.equal(p.scene[3].typeId, 'type_turret');
  assert.equal(p.types.some((t) => t.id === 'type_player'), true);
});

test('ensureProject принимает и v1, и v2, и мусор', () => {
  const v2 = emptyProject();
  assert.equal(ensureProject(v2).types.length, v2.types.length);
  assert.equal(ensureProject({ objects: [] }).meta.version, PROJECT_VERSION);
  assert.equal(ensureProject(null).meta.version, PROJECT_VERSION);
  assert.equal(ensureProject('ерунда').types.length > 0, true);
  const withJunk = { ...v2, types: [{ ...v2.types[0], behaviors: [{ id: 'нет', enabled: true, settings: {} }] }] };
  const fixed = ensureProject(withJunk);
  assert.equal(fixed.types[0].behaviors.some((b) => (b.id as string) === 'нет'), false);
});

test('пустой проект не теряет ни одного типа и листа', () => {
  const p = emptyProject();
  assert.equal(p.types.length, 10);
  assert.ok(p.sheets.length >= 2);
  assert.ok(p.globals.length >= 4);
  assert.ok(p.types.some((t) => t.role === 'player'));
  assert.ok(p.types.some((t) => t.role === 'reserve'));
});