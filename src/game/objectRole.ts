/**
 * Роли объектов сцены.
 *
 * Модуль намеренно без зависимостей — его можно тестировать и импортировать
 * и из редактора, и из движка, и из нормализатора проекта.
 */

/** Роль объекта в превью. */
export type ObjectRole = 'prop' | 'enemy' | 'spawn' | 'player' | 'reserve';

/** Роль в системе типов (game/types). */
export type TypeRole = 'player' | 'enemy' | 'reserve' | 'neutral';

/** Привести произвольное значение к корректной роли объекта. */
export function normObjectRole(role: unknown): ObjectRole {
  if (role === 'player' || role === 'reserve' || role === 'enemy' || role === 'spawn') return role;
  return 'prop';
}

/**
 * Перевести роль объекта в роль системы типов.
 * «Мех игрока» → player, «Резерв» → reserve, «Точка спавна» → reserve (запасная точка),
 * «Враг» → enemy, остальное → neutral.
 */
export function objectRoleToTypeRole(role: unknown): TypeRole {
  switch (normObjectRole(role)) {
    case 'enemy': return 'enemy';
    case 'player': return 'player';
    case 'reserve': return 'reserve';
    case 'spawn': return 'reserve';
    default: return 'neutral';
  }
}

/** Человеческие названия ролей для интерфейса. */
export const OBJECT_ROLE_LABEL: Record<ObjectRole, string> = {
  player: 'Управляемый мех',
  reserve: 'Запасной мех',
  enemy: 'Враг',
  spawn: 'Точка спавна',
  prop: 'Декорация',
};
