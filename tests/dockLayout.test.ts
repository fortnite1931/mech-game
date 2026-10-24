import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PANEL_IDS, PANELS, OURS_PANEL_IDS, type PanelId } from '../src/editor/panels.ts';
import {
  DEFAULT_LAYOUT, LIMITS, closePanel, detach, attach, movePanel, clampLayout,
  defaultLayout, dragSize, loadLayout, normalizeLayout, resetLayout, setActive, setSize, setCollapsed,
  toggleCollapsed, cloneLayout, saveLayout, MIN_VIEWPORT, type DockLayout,
} from '../src/editor/dockLayout.ts';

function countInZones(l: DockLayout) {
  const all = [...l.zones.left, ...l.zones.right, ...l.zones.bottom, ...l.zones.center, ...Object.keys(l.floats)];
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p, (counts.get(p) ?? 0) + 1);
  return counts;
}

test('дефолтный лейаут держит все панели ровно по одному разу', () => {
  const counts = countInZones(DEFAULT_LAYOUT);
  assert.equal(counts.size, ALL_PANEL_IDS.length);
  for (const id of ALL_PANEL_IDS) assert.equal(counts.get(id), 1, `${id} должен встречаться один раз`);
});

test('реестр панелей помечает наши функции и аналоги Construct 3', () => {
  assert.equal(PANELS.world.origin, 'ours');
  assert.equal(PANELS.sound.origin, 'ours');
  assert.equal(PANELS.scenario.origin, 'ours');
  assert.equal(PANELS.inspector.origin, 'c3');
  assert.equal(OURS_PANEL_IDS.includes('minimap'), true);
  assert.equal(OURS_PANEL_IDS.includes('hierarchy'), false);
});

test('movePanel переносит панель между зонами без дублей', () => {
  const next = movePanel(DEFAULT_LAYOUT, 'assets', 'right', 0);
  assert.deepEqual(next.zones.left, ['project', 'hierarchy']);
  // панель встала в начало правой зоны, остальные остались на месте
  assert.equal(next.zones.right[0], 'assets');
  assert.equal(next.zones.right.includes('inspector'), true);
  assert.equal(next.active.right, 'assets');
  for (const id of ALL_PANEL_IDS) assert.equal(countInZones(next).get(id), 1, `${id} задублирован`);
});

test('movePanel в зону float отсоединяет панель', () => {
  const next = movePanel(DEFAULT_LAYOUT, 'inspector', 'float');
  assert.equal(next.zones.right.includes('inspector'), false);
  assert.ok(next.floats.inspector);
  assert.equal(next.active.float, 'inspector');
});

test('detach и attach возвращают панель в исходную зону', () => {
  const off = detach(DEFAULT_LAYOUT, 'sound');
  const back = attach(off, 'sound', 'right');
  assert.equal(back.floats.sound, undefined);
  // панель вернулась в правую зону, состав зоны не изменился
  assert.equal(back.zones.right.includes('sound'), true);
  assert.equal(back.zones.right.length, DEFAULT_LAYOUT.zones.right.length);
});

test('closePanel убирает панель и переназначает активную вкладку', () => {
  const next = closePanel(DEFAULT_LAYOUT, 'inspector', 'right');
  assert.equal(next.zones.right.includes('inspector'), false);
  // активной становится другая вкладка правой зоны
  assert.ok(next.zones.right.includes(next.active.right));
  assert.equal(ALL_PANEL_IDS.includes('inspector'), true);
});

test('setSize клампит по нижней и верхней границам', () => {
  assert.equal(setSize(DEFAULT_LAYOUT, 'left', 10).sizes.left, LIMITS.left[0]);
  assert.equal(setSize(DEFAULT_LAYOUT, 'left', 5000).sizes.left, LIMITS.left[1]);
  assert.equal(setSize(DEFAULT_LAYOUT, 'right', -100).sizes.right, LIMITS.right[0]);
  assert.equal(setSize(DEFAULT_LAYOUT, 'bottom', 9999).sizes.bottom, LIMITS.bottom[1]);
});

test('normalizeLayout выбрасывает мусорные id и выживает на null', () => {
  const dirty = normalizeLayout({
    zones: { left: ['hierarchy', 'fake', null, 42], right: ['hierarchy', 'inspector'] },
    floats: { nope: { x: 1, y: 1, w: 1, h: 1 } },
  });
  assert.deepEqual(dirty.zones.left, ['hierarchy']);
  assert.equal(dirty.zones.right.includes('hierarchy'), false);
  assert.equal(Object.keys(dirty.floats).length, 0);
  assert.doesNotThrow(() => normalizeLayout(null));
  assert.doesNotThrow(() => normalizeLayout('мусор'));
});

test('normalizeLayout возвращает потерянные панели в правую зону', () => {
  const lost = normalizeLayout({ zones: { left: ['hierarchy'], right: [], bottom: [], center: [] }, floats: {} });
  for (const id of ['assets', 'inspector', 'world', 'sound', 'console', 'minimap']) {
    assert.equal(lost.zones.right.includes(id as PanelId), true, `${id} должен вернуться в right`);
  }
});

test('normalizeLayout чинит невалидный active', () => {
  const fixed = normalizeLayout({
    zones: {
      left: ['project', 'hierarchy', 'assets'],
      right: ['inspector', 'environment', 'types', 'sheets', 'fx', 'world', 'mech', 'scenario', 'sound'],
      bottom: ['console', 'minimap'],
      center: [],
    },
    active: { left: 'console', right: 'hierarchy' },
  });
  assert.equal(fixed.active.left, 'assets');
  // невалидный active → последняя вкладка своей зоны
  assert.equal(fixed.active.right, fixed.zones.right[fixed.zones.right.length - 1]);
  assert.equal(fixed.active.left, fixed.zones.left[fixed.zones.left.length - 1]);
});

test('normalizeLayout восстанавливает все панели из битого сохранения', () => {
  const restored = normalizeLayout({ zones: { left: ['world', 'world'] } });
  const counts = countInZones(restored);
  for (const id of ALL_PANEL_IDS) assert.equal(counts.get(id), 1, `${id} потерян при восстановлении`);
});

test('мутаторы не трогают исходный лейаут', () => {
  const before = cloneLayout(DEFAULT_LAYOUT);
  movePanel(DEFAULT_LAYOUT, 'assets', 'bottom');
  detach(DEFAULT_LAYOUT, 'mech');
  closePanel(DEFAULT_LAYOUT, 'sound', 'right');
  setSize(DEFAULT_LAYOUT, 'left', 400);
  toggleCollapsed(DEFAULT_LAYOUT, 'left');
  assert.deepEqual(DEFAULT_LAYOUT, before);
});

test('clampLayout убирает дубликаты и чинит размеры', () => {
  const dirty = { ...cloneLayout(DEFAULT_LAYOUT), zones: { ...DEFAULT_LAYOUT.zones, left: ['assets', 'assets', 'nope'] }, sizes: { left: 1, right: 9999, bottom: 0 } } as unknown as DockLayout;
  const clean = clampLayout(dirty);
  assert.deepEqual(clean.zones.left, ['assets']);
  assert.equal(clean.sizes.left, LIMITS.left[0]);
  assert.equal(clean.sizes.right, LIMITS.right[1]);
});

test('setActive и toggleCollapsed ведут себя предсказуемо', () => {
  const act = setActive(DEFAULT_LAYOUT, 'right', 'mech');
  assert.equal(act.active.right, 'mech');
  assert.equal(setActive(DEFAULT_LAYOUT, 'right', 'sound') .active.right, 'sound');
  assert.equal(setActive(DEFAULT_LAYOUT, 'right', 'world').active.right, 'world');
  assert.equal(toggleCollapsed(DEFAULT_LAYOUT, 'bottom').collapsed.bottom, true);
  assert.equal(toggleCollapsed(toggleCollapsed(DEFAULT_LAYOUT, 'bottom'), 'bottom').collapsed.bottom, false);
});

test('setCollapsed ставит состояние явно и не мутирует исходник', () => {
  const collapsed = setCollapsed(DEFAULT_LAYOUT, 'left', true);
  assert.equal(collapsed.collapsed.left, true);
  assert.equal(setCollapsed(collapsed, 'left', false).collapsed.left, false);
  assert.equal(DEFAULT_LAYOUT.collapsed.left, false);
});

test('панель, брошенная в свёрнутую зону, остаётся доступной', () => {
  const folded = setCollapsed(DEFAULT_LAYOUT, 'right', true);
  const after = movePanel(folded, 'sound', 'right', 0);
  assert.equal(after.zones.right[0], 'sound');
  assert.equal(after.active.right, 'sound');
  const restored = setCollapsed(after, 'right', false);
  assert.equal(restored.zones.right.includes('sound'), true);
});

test('захват границы не сдвигает панель на первом же пикселе', () => {
  // граница левой зоны находится ровно на x = startSize, а мы хватаем её на 2px правее
  const startSize = 375;
  const grab = startSize + 2;
  assert.equal(dragSize('left', startSize, grab, grab), startSize, 'панель не должна прыгать при захвате');
  assert.equal(dragSize('left', startSize, grab, grab + 100), startSize + 100);
  assert.equal(dragSize('left', startSize, grab, grab - 100), startSize - 100);
});

test('правая и нижняя зоны растут в сторону курсора, а не от края окна', () => {
  // правая зона: тянем влево — ширина растёт
  assert.equal(dragSize('right', 360, 1176, 1176), 360);
  assert.equal(dragSize('right', 360, 1176, 1100), 436);
  assert.equal(dragSize('right', 360, 1176, 1250), 286);
  // нижняя зона: тянем вверх — высота растёт
  assert.equal(dragSize('bottom', 200, 400, 400), 200);
  assert.equal(dragSize('bottom', 200, 400, 300), 300);
  assert.equal(dragSize('bottom', 200, 400, 500), 100);
});

test('зоны не могут отобрать всё место у сцены', () => {
  const avail = 1536;
  const wide = setSize({ ...DEFAULT_LAYOUT, sizes: { left: 300, right: 900, bottom: 200 } }, 'left', 1500, avail);
  assert.ok(wide.sizes.left <= avail - 900 - MIN_VIEWPORT.w, `левая зона съела сцену: ${wide.sizes.left}`);
  const tall = setSize(DEFAULT_LAYOUT, 'bottom', 9999, 499);
  assert.ok(tall.sizes.bottom <= 499 - MIN_VIEWPORT.h, `нижняя зона съела сцену: ${tall.sizes.bottom}`);
  // лимит по ширине окна не должен опускаться ниже минимума зоны
  const tiny = setSize(DEFAULT_LAYOUT, 'left', 900, 200);
  assert.ok(tiny.sizes.left >= LIMITS.left[0]);
});

test('resetLayout совпадает с дефолтом, сохранение и загрузка не падают без localStorage', () => {
  assert.deepEqual(resetLayout(), defaultLayout());
  assert.doesNotThrow(() => saveLayout(DEFAULT_LAYOUT));
  const loaded = loadLayout();
  assert.deepEqual(loaded.zones.right.length + loaded.zones.left.length + loaded.zones.bottom.length, ALL_PANEL_IDS.length);
});