import { ALL_PANEL_IDS, type PanelId } from './panels.ts';

export type ZoneId = 'left' | 'right' | 'bottom' | 'center' | 'float';
export type DockZone = Exclude<ZoneId, 'float'>;

export interface FloatRect { x: number; y: number; w: number; h: number; }

export interface DockLayout {
  zones: Record<DockZone, PanelId[]>;
  active: Record<ZoneId, PanelId | null>;
  floats: Partial<Record<PanelId, FloatRect>>;
  sizes: { left: number; right: number; bottom: number };
  collapsed: Record<ZoneId, boolean>;
}

export const ZONES: DockZone[] = ['left', 'right', 'bottom', 'center'];
export const ALL_ZONES: ZoneId[] = [...ZONES, 'float'];

export const LIMITS = {
  left: [220, 760],
  right: [260, 760],
  bottom: [100, 560],
} as const;

// Минимум места, который нельзя отбирать у сцены при растягивании доков.
export const MIN_VIEWPORT = { w: 300, h: 150 };

/**
 * Ширина дока при перетаскивании его границы.
 * Считается ОТНОСИТЕЛЬНО точки захвата: первый же пиксель движения не должен
 * сдвигать панель (иначе она «прыгает» на всю текущую ширину).
 * zone='left' — тянем вправо, 'right'/'bottom' — тянем влево/вверх.
 */
export function dragSize(
  zone: 'left' | 'right' | 'bottom',
  startSize: number,
  startPoint: number,
  point: number,
): number {
  return zone === 'left' ? startSize + (point - startPoint) : startSize + (startPoint - point);
}

export const FLOAT_LIMITS = {
  w: [240, 1600],
  h: [160, 1200],
  pos: [-1600, 3200],
} as const;

export const LAYOUT_STORAGE_KEY = 'wf_dock_layout_v1';

const DEFAULT_FLOAT: FloatRect = { x: 120, y: 120, w: 420, h: 380 };

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isPanelId(v: unknown): v is PanelId {
  return typeof v === 'string' && (ALL_PANEL_IDS as string[]).includes(v);
}

function clampRect(r: Partial<FloatRect> | undefined | null): FloatRect {
  const [wMin, wMax] = FLOAT_LIMITS.w;
  const [hMin, hMax] = FLOAT_LIMITS.h;
  const [pMin, pMax] = FLOAT_LIMITS.pos;
  return {
    x: clampNum(num(r?.x, DEFAULT_FLOAT.x), pMin, pMax),
    y: clampNum(num(r?.y, DEFAULT_FLOAT.y), pMin, pMax),
    w: clampNum(num(r?.w, DEFAULT_FLOAT.w), wMin, wMax),
    h: clampNum(num(r?.h, DEFAULT_FLOAT.h), hMin, hMax),
  };
}

function lastOf(arr: PanelId[]): PanelId | null {
  return arr.length ? arr[arr.length - 1] : null;
}

export function defaultLayout(): DockLayout {
  return {
    zones: {
      left: ['project', 'hierarchy', 'assets'],
      right: ['inspector', 'environment', 'types', 'sheets', 'fx', 'world', 'mech', 'mechbuilder', 'animations', 'scenario', 'assistant', 'saves', 'sound'],
      bottom: ['console', 'minimap'],
      center: [],
    },
    active: { left: 'hierarchy', right: 'inspector', bottom: 'console', center: null, float: null },
    floats: {},
    sizes: { left: 300, right: 360, bottom: 200 },
    collapsed: { left: false, right: false, bottom: false, center: false, float: false },
  };
}

export const DEFAULT_LAYOUT: DockLayout = defaultLayout();

export function cloneLayout(layout: DockLayout): DockLayout {
  return {
    zones: {
      left: [...layout.zones.left],
      right: [...layout.zones.right],
      bottom: [...layout.zones.bottom],
      center: [...layout.zones.center],
    },
    active: { ...layout.active },
    floats: Object.fromEntries(
      Object.entries(layout.floats).map(([k, v]) => [k, { ...v }]),
    ),
    sizes: { ...layout.sizes },
    collapsed: { ...layout.collapsed },
  };
}

export function resetLayout(): DockLayout {
  return defaultLayout();
}

export function clampLayout(layout: DockLayout): DockLayout {
  const l = cloneLayout(layout);
  l.sizes.left = clampNum(l.sizes.left, LIMITS.left[0], LIMITS.left[1]);
  l.sizes.right = clampNum(l.sizes.right, LIMITS.right[0], LIMITS.right[1]);
  l.sizes.bottom = clampNum(l.sizes.bottom, LIMITS.bottom[0], LIMITS.bottom[1]);
  for (const z of ZONES) {
    const seen = new Set<PanelId>();
    const out: PanelId[] = [];
    for (const p of l.zones[z]) {
      if (!isPanelId(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    l.zones[z] = out;
  }
  return l;
}

function pullOut(l: DockLayout, panel: PanelId) {
  for (const z of ZONES) {
    const i = l.zones[z].indexOf(panel);
    if (i >= 0) l.zones[z].splice(i, 1);
  }
  delete l.floats[panel];
}

function fixActive(l: DockLayout, zone: DockZone) {
  const cur = l.active[zone];
  l.active[zone] = cur && l.zones[zone].includes(cur) ? cur : lastOf(l.zones[zone]);
}

export function setActive(layout: DockLayout, zone: ZoneId, panel: PanelId | null): DockLayout {
  const l = cloneLayout(layout);
  if (zone === 'float') {
    l.active.float = panel && l.floats[panel] ? panel : (Object.keys(l.floats)[0] as PanelId | undefined) ?? null;
    return l;
  }
  l.active[zone] = panel && l.zones[zone].includes(panel) ? panel : lastOf(l.zones[zone]);
  return l;
}

export function detach(layout: DockLayout, panel: PanelId, rect?: FloatRect): DockLayout {
  const l = cloneLayout(layout);
  pullOut(l, panel);
  l.floats[panel] = clampRect(rect ?? l.floats[panel] ?? DEFAULT_FLOAT);
  l.active.float = panel;
  for (const z of ZONES) fixActive(l, z);
  return clampLayout(l);
}

export function attach(layout: DockLayout, panel: PanelId, to: DockZone, index?: number): DockLayout {
  const l = cloneLayout(layout);
  pullOut(l, panel);
  const arr = l.zones[to];
  const at = index === undefined ? arr.length : clampNum(index, 0, arr.length);
  arr.splice(at, 0, panel);
  l.active[to] = panel;
  return clampLayout(l);
}

export function movePanel(layout: DockLayout, panel: PanelId, to: ZoneId, index?: number): DockLayout {
  if (!isPanelId(panel)) return clampLayout(layout);
  if (to === 'float') return detach(layout, panel);
  return attach(layout, panel, to, index);
}

export function closePanel(layout: DockLayout, panel: PanelId, fallback: DockZone): DockLayout {
  const l = cloneLayout(layout);
  const wasFloating = Boolean(l.floats[panel]);
  const wasIn = ZONES.find((z) => l.zones[z].includes(panel));
  pullOut(l, panel);
  if (wasFloating) {
    l.active.float = (Object.keys(l.floats)[0] as PanelId | undefined) ?? null;
  } else {
    fixActive(l, wasIn ?? fallback);
  }
  return clampLayout(l);
}

export function setSize(layout: DockLayout, zone: 'left' | 'right' | 'bottom', px: number, avail?: number): DockLayout {
  const l = cloneLayout(layout);
  const [min, max] = LIMITS[zone];
  let hi: number = max;
  if (typeof avail === 'number' && Number.isFinite(avail)) {
    if (zone === 'left') hi = Math.min(max, avail - l.sizes.right - MIN_VIEWPORT.w);
    else if (zone === 'right') hi = Math.min(max, avail - l.sizes.left - MIN_VIEWPORT.w);
    else hi = Math.min(max, avail - MIN_VIEWPORT.h);
  }
  l.sizes[zone] = clampNum(px, min, Math.max(min, hi));
  return l;
}

export function toggleCollapsed(layout: DockLayout, zone: ZoneId): DockLayout {
  const l = cloneLayout(layout);
  l.collapsed[zone] = !l.collapsed[zone];
  return l;
}

export function setCollapsed(layout: DockLayout, zone: ZoneId, collapsed: boolean): DockLayout {
  const l = cloneLayout(layout);
  l.collapsed[zone] = collapsed;
  return l;
}

export function normalizeLayout(raw: unknown): DockLayout {
  const l = defaultLayout();
  if (!raw || typeof raw !== 'object') return l;
  const src = raw as Partial<DockLayout>;
  const seen = new Set<PanelId>();

  for (const z of ZONES) {
    const arr = Array.isArray(src.zones?.[z]) ? src.zones[z] : [];
    const out: PanelId[] = [];
    for (const p of arr) {
      if (!isPanelId(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    l.zones[z] = out;
  }

  if (src.floats && typeof src.floats === 'object') {
    for (const [k, v] of Object.entries(src.floats as Record<string, unknown>)) {
      if (!isPanelId(k) || seen.has(k) || !v || typeof v !== 'object') continue;
      seen.add(k);
      l.floats[k] = clampRect(v as FloatRect);
    }
  }

  for (const id of ALL_PANEL_IDS) {
    if (!seen.has(id)) l.zones.right.push(id);
  }

  l.sizes.left = clampNum(num(src.sizes?.left, DEFAULT_LAYOUT.sizes.left), LIMITS.left[0], LIMITS.left[1]);
  l.sizes.right = clampNum(num(src.sizes?.right, DEFAULT_LAYOUT.sizes.right), LIMITS.right[0], LIMITS.right[1]);
  l.sizes.bottom = clampNum(num(src.sizes?.bottom, DEFAULT_LAYOUT.sizes.bottom), LIMITS.bottom[0], LIMITS.bottom[1]);

  for (const z of ZONES) {
    const a = src.active?.[z];
    l.active[z] = isPanelId(a) && l.zones[z].includes(a) ? a : lastOf(l.zones[z]);
  }
  const fa = src.active?.float;
  l.active.float = isPanelId(fa) && l.floats[fa] ? fa : (Object.keys(l.floats)[0] as PanelId | undefined) ?? null;

  for (const z of ALL_ZONES) {
    l.collapsed[z] = src.collapsed?.[z] === true;
  }

  return clampLayout(l);
}

export function saveLayout(layout: DockLayout): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch { /* приватный режим или переполнение */ }
}

export function loadLayout(): DockLayout {
  try {
    if (typeof localStorage === 'undefined') return resetLayout();
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return resetLayout();
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return resetLayout();
  }
}