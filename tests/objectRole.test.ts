import test from 'node:test';
import assert from 'node:assert/strict';
import { normObjectRole, objectRoleToTypeRole, OBJECT_ROLE_LABEL } from '../src/game/objectRole.ts';

/**
 * Регрессия: при сохранении/загрузке проекта терялись роли объектов.
 * «Мех игрока» и «Резервный мех» превращались в «Декорацию», а в систему типов
 * попадали как neutral — из-за этого после загрузки управлялся не тот мех.
 */

test('normObjectRole держит все пять ролей', () => {
  assert.equal(normObjectRole('player'), 'player');
  assert.equal(normObjectRole('reserve'), 'reserve');
  assert.equal(normObjectRole('enemy'), 'enemy');
  assert.equal(normObjectRole('spawn'), 'spawn');
  assert.equal(normObjectRole('prop'), 'prop');
  // неизвестное значение → безопасная декорация
  assert.equal(normObjectRole(undefined), 'prop');
  assert.equal(normObjectRole('летающий'), 'prop');
});

test('роль «мех игрока» не превращается в neutral при переносе в систему типов', () => {
  assert.equal(objectRoleToTypeRole('player'), 'player');
  assert.equal(objectRoleToTypeRole('reserve'), 'reserve');
  assert.equal(objectRoleToTypeRole('enemy'), 'enemy');
  // точка спавна — это запасная точка появления
  assert.equal(objectRoleToTypeRole('spawn'), 'reserve');
  assert.equal(objectRoleToTypeRole('prop'), 'neutral');
});

test('у каждой роли есть человеческое название', () => {
  assert.equal(OBJECT_ROLE_LABEL.player, 'Управляемый мех');
  assert.equal(OBJECT_ROLE_LABEL.reserve, 'Запасной мех');
  assert.equal(OBJECT_ROLE_LABEL.enemy, 'Враг');
  assert.equal(OBJECT_ROLE_LABEL.spawn, 'Точка спавна');
  assert.equal(OBJECT_ROLE_LABEL.prop, 'Декорация');
});
