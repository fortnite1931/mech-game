export type PanelId =
  | 'hierarchy'
  | 'assets'
  | 'inspector'
  | 'environment'
  | 'types'
  | 'sheets'
  | 'project'
  | 'fx'
  | 'world'
  | 'mech'
  | 'scenario'
  | 'sound'
  | 'minimap'
  | 'console'
  | 'assistant'
  | 'saves'
  | 'mechbuilder'
  | 'animations';

export type PanelOrigin = 'c3' | 'ours';

export interface PanelDef {
  id: PanelId;
  title: string;
  origin: PanelOrigin;
  c3Note: string;
}

export const PANELS: Record<PanelId, PanelDef> = {
  hierarchy: { id: 'hierarchy', title: 'Структура', origin: 'c3', c3Note: 'Аналог панели Structure (Object types / Scenes)' },
  assets: { id: 'assets', title: 'Библиотека', origin: 'c3', c3Note: 'Аналог раздела Assets / Sprites' },
  inspector: { id: 'inspector', title: 'Свойства', origin: 'c3', c3Note: 'Аналог панели Properties' },
  environment: { id: 'environment', title: 'Окружение', origin: 'c3', c3Note: 'Свойства сцены: небо, туман, свет' },
  fx: { id: 'fx', title: 'Эффекты', origin: 'ours', c3Note: 'Пофайловые выключатели видимости эффектов для удобства редактирования — в Construct 3 нет' },
  types: { id: 'types', title: 'Типы объектов', origin: 'ours', c3Note: 'Типы с наследованием и модульными настройками — аналог Object types в Construct 3' },
  sheets: { id: 'sheets', title: 'События', origin: 'ours', c3Note: 'Визуальные листы событий: условия и действия — как в Construct 3' },
  project: { id: 'project', title: 'Проект', origin: 'ours', c3Note: 'Дерево проекта: макеты, листы событий, типы и переменные' },
  world: { id: 'world', title: 'Мир', origin: 'ours', c3Note: 'Процедурная генерация мира чанками с сидом — в Construct 3 нет' },
  mech: { id: 'mech', title: 'Мех', origin: 'ours', c3Note: 'Тюнинг шасси, камеры и оружия меха — в Construct 3 нет' },
  scenario: { id: 'scenario', title: 'Сценарий', origin: 'ours', c3Note: 'Редактор волн врагов и баланса боя — в Construct 3 нет' },
  sound: { id: 'sound', title: 'Звук', origin: 'ours', c3Note: 'Привязка своих аудиофайлов к событиям с контролем голосов — в Construct 3 нет' },
  minimap: { id: 'minimap', title: 'Мини-карта', origin: 'ours', c3Note: 'Обзорная карта сцены — в Construct 3 нет' },
  console: { id: 'console', title: 'Консоль', origin: 'c3', c3Note: 'Аналог консоли отладки' },
  assistant: { id: 'assistant', title: 'Помощник', origin: 'ours', c3Note: 'ИИ-агент с правкой кода проекта и vision-снимками — в Construct 3 нет' },
  saves: { id: 'saves', title: 'Сохранения', origin: 'ours', c3Note: 'Файлы проекта с логикой и звуками, автосейв и архив на диск — в Construct 3 нет' },
  mechbuilder: { id: 'mechbuilder', title: 'Конструктор меха', origin: 'ours', c3Note: 'Сборка меха из деталей: размеры, части и скульптинг — в Construct 3 нет' },
  animations: { id: 'animations', title: 'Анимации', origin: 'ours', c3Note: 'Редактор анимаций: таймлайн, нарезка, скорость, экспорт — в Construct 3 нет' },
};

export const ALL_PANEL_IDS = Object.keys(PANELS) as PanelId[];

export const OURS_PANEL_IDS: PanelId[] = ALL_PANEL_IDS.filter((id) => PANELS[id].origin === 'ours');

export const C3_PANEL_IDS: PanelId[] = ALL_PANEL_IDS.filter((id) => PANELS[id].origin === 'c3');