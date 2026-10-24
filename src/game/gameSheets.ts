import type { EventSheet } from './project.ts';
import { act, cond, ev } from './sheetBuilder.ts';

/**
 * Листы событий игры-шаблона. Здесь описана вся игровая логика:
 * пилот вне меха, мех игрока, резервы, враги, волны, пропы и мир.
 * Именно эти данные в Ф3 начнёт исполнять рантайм вместо хардкода в плеере.
 */
export function buildSheets(): EventSheet[] {
  return [
    sheetPilot(),
    sheetPlayerMech(),
    sheetReserve(),
    sheetEnemies(),
    sheetWaves(),
    sheetProps(),
    sheetWorld(),
  ];
}

// ---------------- пилот вне меха ----------------
function sheetPilot(): EventSheet {
  return {
    id: 'sheet_pilot',
    name: 'Пилот',
    comment: 'Персонаж, который вышел из меха. Базовая логика: посадка в резерв, урон, движение.',
    rows: [
      ev('on_spawn', [
        act('set_variable', { name: 'pilot_mech', value: 0 }),
        act('walk_to', { speed: 4 }),
        act('log', { text: 'Пилот покинул машину' }),
      ], { comment: 'Старт без машины — пилот оказался на земле' }),

      ev('on_key', [
        act('board', { target: 'nearest_reserve' }),
        act('set_variable', { name: 'pilot_mech', value: 1 }),
      ], {
        comment: 'E рядом с резервом — садится в машину',
        condition: cond('nearest_type', { target: 'reserve', maxDistance: 4 }),
        else: [act('log', { text: 'Рядом нет доступного меха' })],
      }),

      ev('on_collision', [
        act('board', { target: 'self' }),
      ], {
        comment: 'Врезался в резервный мех — можно сесть',
        condition: cond('nearest_type', { target: 'reserve', maxDistance: 6 }),
      }),

      ev('on_update', [
        act('walk_to', { speed: 4 }),
      ], {
        comment: 'Идёт к цели, пока пилот не в машине',
        condition: cond('is_pilot', { value: false }),
      }),

      ev('on_damaged', [
        act('log', { text: 'Пилот ранен' }),
        act('spawn_fx', { effect: 'sparks', scale: 0.6 }),
      ], {
        comment: 'Ранение: не спамим чаще раза в 2 секунды',
        condition: cond('cooldown', { interval: 2 }),
      }),

      ev('on_destroyed', [
        act('end_game', { result: 'lost' }),
      ], { comment: 'Пилот погиб — поражение' }),
    ],
  };
}

// ---------------- мех игрока ----------------
function sheetPlayerMech(): EventSheet {
  return {
    id: 'sheet_player_mech',
    name: 'Мех игрока',
    comment: 'Машина под управлением игрока: высадка пилота, перегрев, гибель.',
    rows: [
      ev('on_spawn', [
        act('set_variable', { name: 'pilot_mech', value: 1 }),
        act('set_camera', { view: 'third' }),
      ], { comment: 'Игра начинается в кабине' }),

      ev('on_key', [
        act('spawn_pilot', { offset: 3 }),
        act('set_variable', { name: 'pilot_mech', value: 0 }),
      ], { comment: 'F — выйти из машины пешком', condition: cond('is_pilot', { value: true }) }),

      ev('on_overheat', [
        act('log', { text: 'Перегрев реактора' }),
        act('wait', { seconds: 3.5 }),
      ], { comment: 'Аварийное отключение на 3.5 секунды' }),

      ev('on_damaged', [
        act('spawn_fx', { effect: 'sparks', scale: 1 }),
        act('play_sound', { event: 'hit' }),
      ], { comment: 'Попадание: искры и звук' }),

      ev('on_destroyed', [
        act('end_game', { result: 'lost' }),
      ], { comment: 'Мех уничтожен — поражение' }),
    ],
  };
}

// ---------------- резервные мехи ----------------
function sheetReserve(): EventSheet {
  return {
    id: 'sheet_reserve',
    name: 'Резервы',
    comment: 'Точки появления запасных машин: пилот сел — машина спит, пилот вышел — машина снова охраняет.',
    rows: [
      ev('on_spawn', [
        act('set_state', { state: 'patrol' }),
        act('enable_behavior', { behavior: 'ai_mech', enabled: true }),
      ], { comment: 'Без пилота резерв охраняет район' }),

      ev('on_pilot_enter', [
        act('set_state', { state: 'idle' }),
        act('enable_behavior', { behavior: 'ai_mech', enabled: false }),
        act('log', { text: 'Пилот занял резервный мех' }),
      ]),

      ev('on_pilot_exit', [
        act('set_state', { state: 'patrol' }),
        act('enable_behavior', { behavior: 'ai_mech', enabled: true }),
        act('log', { text: 'Резервный мех остался без пилота' }),
      ]),
    ],
  };
}

// ---------------- враги ----------------
function sheetEnemies(): EventSheet {
  return {
    id: 'sheet_enemies',
    name: 'Враги',
    comment: 'Поведение боевых машин и турелей: патруль → преследование → атака.',
    rows: [
      ev('on_spawn', [
        act('set_state', { state: 'patrol' }),
        act('play_sound', { event: 'step' }),
      ], { comment: 'Враг появляется в режиме патруля' }),

      ev('on_update', [
        act('set_state', { state: 'chase' }),
      ], {
        comment: 'Пилот ближе радиуса — преследовать',
        condition: cond('cooldown', { interval: 0.2 }),
      }),

      ev('on_update', [
        act('set_state', { state: 'attack' }),
        act('move_towards', { target: 'player', speed: 4 }),
        act('turn_to', { target: 'player' }),
        act('fire', { slot: '1' }),
      ], {
        comment: 'Вошли в дистанцию боя — атака',
        condition: cond('distance', { target: 'player', op: '<', value: 45 }),
      }),

      ev('on_damaged', [
        act('play_sound', { event: 'hit' }),
        act('spawn_fx', { effect: 'sparks', scale: 0.8 }),
      ]),

      ev('on_destroyed', [
        act('add_variable', { name: 'kills', delta: 1 }),
        act('spawn_fx', { effect: 'explosion', scale: 2 }),
        act('play_sound', { event: 'explosion' }),
        act('log', { text: 'Враг уничтожен' }),
      ], { comment: 'Учёт убийства и взрыв' }),
    ],
  };
}

// ---------------- волны и победа ----------------
function sheetWaves(): EventSheet {
  return {
    id: 'sheet_waves',
    name: 'Волны',
    comment: 'Сценарий боя: волны врагов, победа и поражение.',
    rows: [
      ev('on_spawn', [
        act('start_wave', { index: '0', delay: 5 }),
      ], { comment: 'Первая волна через 5 секунд' }),

      ev('on_enemy_killed', [
        act('start_wave', { index: 'next', delay: 8 }),
      ], {
        comment: 'Врагов не осталось — следующая волна',
        condition: cond('has_enemies', { target: 'enemy' }),
        else: [],
      }),

      ev('on_wave_started', [
        act('end_game', { result: 'won' }),
      ], {
        comment: 'Волны кончились — победа',
        condition: cond('var_compare', { name: 'wave', op: '>', value: 3 }),
      }),

      ev('on_wave_started', [
        act('log', { text: 'Началась волна' }),
      ], {
        condition: cond('var_compare', { name: 'wave', op: '<=', value: 3 }),
      }),
    ],
  };
}

// ---------------- пропы и бочки ----------------
function sheetProps(): EventSheet {
  return {
    id: 'sheet_props',
    name: 'Пропы и бочки',
    comment: 'Разрушаемые объекты: смятие, цепные взрывы топлива и токсичных бочек.',
    rows: [
      ev('on_damaged', [
        act('spawn_fx', { effect: 'dust', scale: 0.7 }),
      ], { comment: 'Проп повреждён — пыль' }),

      ev('on_destroyed', [
        act('spawn_fx', { effect: 'dust', scale: 1.4 }),
        act('log', { text: 'Пустой проп смят' }),
      ], {
        comment: 'Пустая бочка или мусор просто сминаются',
        condition: cond('var_compare', { name: 'contents', op: '=', value: 0 }),
        else: [
          act('spawn_fx', { effect: 'explosion', scale: 1.2 }),
          act('play_sound', { event: 'explosion' }),
          act('damage', { target: 'nearby', amount: 45 }),
          act('shake_camera', { amount: 0.4 }),
          act('log', { text: 'Цепной взрыв!' }),
        ],
      }),
    ],
  };
}

// ---------------- мир ----------------
function sheetWorld(): EventSheet {
  return {
    id: 'sheet_world',
    name: 'Мир',
    comment: 'Фоновые вещи мира: подгрузка чанков и атмосфера.',
    rows: [
      ev('on_timer', [
        act('set_variable', { name: 'chunk', delta: 1 }),
      ], { comment: 'Мир достраивается порциями по мере движения' }),

      ev('on_spawn', [
        act('play_sound', { event: 'overheat' }),
      ], { comment: 'Фоновая атмосфера: редкий гул реактора' }),
    ],
  };
}