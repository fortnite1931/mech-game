import { BOOL, COLOR, ENUM, NUM, TEXT, defaultValues, type PropDef, type PropValues } from './props.ts';
import { CHASSIS, WEAPON_LIST } from '../three/playTypes.ts';

export type BehaviorId =
  | 'movement'
  | 'weapons'
  | 'camera'
  | 'cockpit'
  | 'survivability'
  | 'ai_mech'
  | 'ai_turret'
  | 'prop_physics'
  | 'destroyable'
  | 'pilot';

export interface BehaviorDef {
  id: BehaviorId;
  name: string;
  category: 'мех' | 'оружие' | 'камера' | 'интерфейс' | 'бой' | 'ии' | 'мир' | 'пилот';
  desc: string;
  props: PropDef[];
}

export const MOVEMENT_PROPS: PropDef[] = [
  NUM('maxSpeed', 'Макс. скорость, км/ч', 34, 5, 120, 1, { group: 'Ход' }),
  NUM('accel', 'Отклик газа', 0.6, 0.1, 1, 0.05, { group: 'Ход', hint: 'Плавность разгона' }),
  NUM('turnSpeed', 'Скорость поворота, °/с', 70, 10, 200, 5, { group: 'Ход' }),
  NUM('torsoTwist', 'Поворот корпуса, °', 110, 0, 180, 5, { group: 'Ход' }),
  NUM('brakeFactor', 'Торможение задним ходом', 0.6, 0.1, 1, 0.05, { group: 'Ход' }),
  BOOL('jumpJets', 'Силовые прыжки', true, { group: 'Прыжки' }),
  NUM('jetThrust', 'Тяга джетов', 30, 5, 60, 1, { group: 'Прыжки' }),
  NUM('gravity', 'Гравитация', 22, 5, 60, 1, { group: 'Прыжки' }),
  NUM('jetRefill', 'Восстановление топлива', 15, 1, 60, 1, { group: 'Прыжки' }),
];

export const WEAPONS_PROPS: PropDef[] = [
  ENUM('slot1', 'Слот 1', WEAPON_LIST[0], WEAPON_LIST, { group: 'Слоты' }),
  ENUM('slot2', 'Слот 2', WEAPON_LIST[1], WEAPON_LIST, { group: 'Слоты' }),
  ENUM('slot3', 'Слот 3', WEAPON_LIST[2], WEAPON_LIST, { group: 'Слоты' }),
  ENUM('slot4', 'Слот 4', WEAPON_LIST[3], WEAPON_LIST, { group: 'Слоты' }),
  NUM('rateMul', 'Множитель темпа стрельбы', 1, 0.1, 3, 0.05, { group: 'Стрельба' }),
  NUM('salvoMul', 'Множитель залпа', 1, 0.5, 3, 0.05, { group: 'Стрельба' }),
  NUM('spreadMul', 'Множитель разброса', 1, 0, 4, 0.05, { group: 'Стрельба' }),
  NUM('heatMul', 'Множитель нагрева', 1, 0, 3, 0.05, { group: 'Перегрев' }),
  NUM('overheatCooldown', 'Остывание, °/с', 22, 1, 80, 1, { group: 'Перегрев' }),
  NUM('rangeMul', 'Множитель дальности', 1, 0.2, 3, 0.05, { group: 'Стрельба' }),
];

export const CAMERA_PROPS: PropDef[] = [
  ENUM('defaultView', 'Вид по умолчанию', 'third', ['cockpit', 'third', 'shoulder', 'tactical'], { group: 'Виды' }),
  NUM('sensitivity', 'Чувствительность мыши', 1, 0.1, 4, 0.05, { group: 'Управление' }),
  BOOL('invertY', 'Инверсия по вертикали', false, { group: 'Управление' }),
  BOOL('cameraNeedsMMB', 'Камера только на СКМ', true, { group: 'Управление' }),
  NUM('cockpitFov', 'FOV из кабины', 78, 50, 110, 1, { group: 'Кабина' }),
  NUM('cockpitHeight', 'Высота кабины', 0, -1, 3, 0.05, { group: 'Кабина' }),
  NUM('cockpitForward', 'Смещение вперёд', 0, -1, 3, 0.05, { group: 'Кабина' }),
  NUM('cockpitSway', 'Покачивание в кабине', 0.6, 0, 2, 0.05, { group: 'Кабина' }),
  NUM('pitchLimit', 'Предел наклона, °', 45, 10, 89, 1, { group: 'Кабина' }),
  NUM('thirdDistance', 'Дистанция 3-го лица', 11, 3, 40, 0.5, { group: 'Вид 3-го лица' }),
  NUM('thirdHeight', 'Высота камеры', 3.4, 0, 20, 0.1, { group: 'Вид 3-го лица' }),
  NUM('thirdFov', 'FOV 3-го лица', 55, 30, 100, 1, { group: 'Вид 3-го лица' }),
  NUM('thirdSmoothing', 'Сглаживание камеры', 7, 1, 30, 0.5, { group: 'Вид 3-го лица' }),
  BOOL('thirdAutoFollow', 'Автоследование', true, { group: 'Вид 3-го лица' }),
  NUM('shoulderDistance', 'Дистанция из-за плеча', 5.5, 1, 20, 0.5, { group: 'Плечо' }),
  NUM('shoulderHeight', 'Высота над плечом', 4, 0, 15, 0.1, { group: 'Плечо' }),
  NUM('shoulderSide', 'Смещение вбок', 1.9, -6, 6, 0.1, { group: 'Плечо' }),
  NUM('shoulderFov', 'FOV из-за плеча', 50, 30, 100, 1, { group: 'Плечо' }),
  NUM('tacticalDistance', 'Дистанция тактики', 26, 5, 80, 1, { group: 'Тактика' }),
  NUM('tacticalPitch', 'Наклон тактики', 52, 10, 89, 1, { group: 'Тактика' }),
  NUM('tacticalFov', 'FOV тактики', 42, 20, 90, 1, { group: 'Тактика' }),
  BOOL('tacticalAutoFollow', 'Автоследование', false, { group: 'Тактика' }),
];

export const COCKPIT_PROPS: PropDef[] = [
  COLOR('hudColor', 'Цвет HUD', '#7cf5b0', { group: 'Вид' }),
  NUM('frameOpacity', 'Прозрачность рамы', 0.9, 0, 1, 0.05, { group: 'Вид' }),
  BOOL('scanlines', 'Сканлайны', true, { group: 'Вид' }),
  BOOL('showRadar', 'Радар', true, { group: 'Интерфейс' }),
  BOOL('showWeapons', 'Панель оружия', true, { group: 'Интерфейс' }),
  BOOL('showDamage', 'Индикатор повреждений', true, { group: 'Интерфейс' }),
];

export const SURVIVABILITY_PROPS: PropDef[] = [
  NUM('maxHp', 'Прочность корпуса', 300, 10, 3000, 10, { group: 'Живучесть' }),
  NUM('damageMul', 'Множитель получаемого урона', 1, 0, 5, 0.05, { group: 'Живучесть' }),
  NUM('invulnTime', 'Неуязвимость после попадания, с', 0.15, 0, 2, 0.05, { group: 'Живучесть' }),
  BOOL('destroyOnDeath', 'Уничтожать при смерти', true, { group: 'Живучесть' }),
];

export const AI_MECH_PROPS: PropDef[] = [
  NUM('aggroRadius', 'Радиус обнаружения, м', 70, 5, 200, 5, { group: 'Восприятие' }),
  NUM('attackRange', 'Дистанция боя, м', 45, 5, 150, 5, { group: 'Восприятие' }),
  NUM('speed', 'Скорость, м/с', 5, 0, 25, 0.5, { group: 'Движение' }),
  NUM('patrolSpeed', 'Скорость патруля', 0.35, 0, 1, 0.05, { group: 'Движение' }),
  NUM('patrolRadius', 'Радиус патруля, м', 9, 0, 60, 1, { group: 'Движение' }),
  NUM('turnSpeed', 'Скорость поворота, рад/с', 3, 0.5, 10, 0.1, { group: 'Движение' }),
  NUM('strafeAmount', 'Стрейф при бою', 0.5, 0, 2, 0.05, { group: 'Бой' }),
  NUM('aimError', 'Неточность прицела', 0.035, 0, 0.3, 0.005, { group: 'Бой' }),
  NUM('burstDelay', 'Пауза между залпами, с', 1.4, 0.2, 6, 0.1, { group: 'Бой' }),
];

export const AI_TURRET_PROPS: PropDef[] = [
  NUM('range', 'Дальность, м', 90, 5, 250, 5, { group: 'Огонь' }),
  NUM('damage', 'Урон попадания', 8, 1, 200, 1, { group: 'Огонь' }),
  NUM('fireInterval', 'Интервал выстрела, с', 1.2, 0.1, 6, 0.05, { group: 'Огонь' }),
  NUM('turnSpeed', 'Скорость наводки, рад/с', 2.5, 0.2, 10, 0.1, { group: 'Наводка' }),
  NUM('aimTolerance', 'Допуск наводки, рад', 0.12, 0.01, 1, 0.01, { group: 'Наводка' }),
  NUM('idleScan', 'Сканирование в покое, рад/с', 0.3, 0, 2, 0.05, { group: 'Наводка' }),
];

export const PROP_PHYSICS_PROPS: PropDef[] = [
  ENUM('mass', 'Масса', 'heavy', ['light', 'medium', 'heavy'], { group: 'Физика' }),
  BOOL('stepOver', 'Можно переступать', false, { group: 'Физика' }),
  NUM('kick', 'Отбрасывание импульсом', 0.35, 0, 2, 0.05, { group: 'Физика' }),
  BOOL('squashable', 'Сминается под весом', false, { group: 'Физика' }),
  BOOL('rollable', 'Катится', true, { group: 'Физика' }),
  NUM('tonnage', 'Тоннаж', 1, 0.1, 100, 0.5, { group: 'Физика' }),
];

export const DESTROYABLE_PROPS: PropDef[] = [
  NUM('hp', 'Прочность', 30, 1, 5000, 5, { group: 'Прочность' }),
  ENUM('contents', 'Содержимое', 'none', ['none', 'fuel', 'tox'], { group: 'Содержимое' }),
  NUM('blastRadius', 'Радиус взрыва, м', 6, 0.5, 40, 0.5, { group: 'Взрыв' }),
  NUM('blastDamage', 'Урон взрыва', 45, 0, 300, 5, { group: 'Взрыв' }),
  BOOL('chain', 'Цепная реакция', true, { group: 'Взрыв' }),
  BOOL('scorch', 'Оставляет копоть', true, { group: 'Взрыв' }),
];

export const PILOT_PROPS: PropDef[] = [
  BOOL('pilotable', 'Можно сесть', true, { group: 'Пилот' }),
  BOOL('playerStart', 'Стартовый мех пилота', false, { group: 'Пилот', hint: 'Именно в нём пилот начинает игру' }),
  NUM('boardRadius', 'Радиус посадки, м', 4, 1, 20, 0.5, { group: 'Пилот' }),
  BOOL('allowEject', 'Можно покинуть мех', true, { group: 'Пилот' }),
  BOOL('aiEnabled', 'Мех управляется ИИ без пилота', false, { group: 'Пилот' }),
  TEXT('pilotName', 'Имя пилота', 'Пилот', { group: 'Пилот' }),
];

export const BEHAVIORS: Record<BehaviorId, BehaviorDef> = {
  movement: {
    id: 'movement', name: 'Движение', category: 'мех',
    desc: 'Ход, разгон, поворот корпуса и силовые прыжки.',
    props: MOVEMENT_PROPS,
  },
  weapons: {
    id: 'weapons', name: 'Оружие', category: 'оружие',
    desc: 'Четыре слота, темп стрельбы, залп, разброс и перегрев.',
    props: WEAPONS_PROPS,
  },
  camera: {
    id: 'camera', name: 'Камера', category: 'камера',
    desc: 'Виды от первого лица, 3-е лицо, плечо и тактика, чувствительность.',
    props: CAMERA_PROPS,
  },
  cockpit: {
    id: 'cockpit', name: 'Кабина и HUD', category: 'интерфейс',
    desc: 'Рама брони, сканлайны, цвет HUD и состав приборов.',
    props: COCKPIT_PROPS,
  },
  survivability: {
    id: 'survivability', name: 'Живучесть', category: 'бой',
    desc: 'Прочность корпуса, получаемый урон, неуязвимость.',
    props: SURVIVABILITY_PROPS,
  },
  ai_mech: {
    id: 'ai_mech', name: 'ИИ: мех', category: 'ии',
    desc: 'Обнаружение, преследование, дистанция боя, стрейф и точность.',
    props: AI_MECH_PROPS,
  },
  ai_turret: {
    id: 'ai_turret', name: 'ИИ: турель', category: 'ии',
    desc: 'Дальность, урон, темп, наводка и сканирование в покое.',
    props: AI_TURRET_PROPS,
  },
  prop_physics: {
    id: 'prop_physics', name: 'Физика пропов', category: 'мир',
    desc: 'Масса, переступание, сминание и отбрасывание.',
    props: PROP_PHYSICS_PROPS,
  },
  destroyable: {
    id: 'destroyable', name: 'Разрушаемость', category: 'мир',
    desc: 'Прочность, содержимое, взрыв и цепная реакция.',
    props: DESTROYABLE_PROPS,
  },
  pilot: {
    id: 'pilot', name: 'Пилот', category: 'пилот',
    desc: 'Посадка в мех, выход, управление ИИ без пилота.',
    props: PILOT_PROPS,
  },
};

export const BEHAVIOR_IDS = Object.keys(BEHAVIORS) as BehaviorId[];

export function behaviorDef(id: BehaviorId): BehaviorDef | undefined {
  return BEHAVIORS[id];
}

/** Значения настроек поведения по умолчанию. */
export function behaviorDefaults(id: BehaviorId): PropValues {
  return defaultValues(BEHAVIORS[id].props);
}

export const CHASSIS_IDS = Object.keys(CHASSIS);