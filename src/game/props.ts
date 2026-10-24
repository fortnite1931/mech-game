export type PropKind = 'number' | 'bool' | 'string' | 'enum' | 'color' | 'objectRef';
export type PropValue = number | boolean | string;
export type PropValues = Record<string, PropValue>;

export interface PropDef {
  key: string;
  label: string;
  kind: PropKind;
  def: PropValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  hint?: string;
  group?: string;
}

export const NUM = (
  key: string, label: string, def: number,
  min: number, max: number, step = 0.05, extra: Partial<PropDef> = {},
): PropDef => ({ key, label, kind: 'number', def, min, max, step, ...extra });

export const BOOL = (key: string, label: string, def: boolean, extra: Partial<PropDef> = {}): PropDef =>
  ({ key, label, kind: 'bool', def, ...extra });

export const TEXT = (key: string, label: string, def = '', extra: Partial<PropDef> = {}): PropDef =>
  ({ key, label, kind: 'string', def, ...extra });

export const ENUM = (key: string, label: string, def: string, options: string[], extra: Partial<PropDef> = {}): PropDef =>
  ({ key, label, kind: 'enum', def, options: options.map((v) => ({ value: v, label: v })), ...extra });

export const COLOR = (key: string, label: string, def: string, extra: Partial<PropDef> = {}): PropDef =>
  ({ key, label, kind: 'color', def, ...extra });

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function clampNumber(v: number, def: PropDef): number {
  if (!Number.isFinite(v)) return Number(def.def);
  let out = v;
  if (typeof def.min === 'number') out = Math.max(def.min, out);
  if (typeof def.max === 'number') out = Math.min(def.max, out);
  return out;
}

export function coerceProp(def: PropDef, raw: unknown): PropValue {
  switch (def.kind) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return clampNumber(n, def);
    }
    case 'bool':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'enum': {
      const s = String(raw ?? '');
      return def.options?.some((o) => o.value === s) ? s : String(def.def);
    }
    case 'color': {
      const s = String(raw ?? '');
      return HEX.test(s) ? s : String(def.def);
    }
    default:
      return typeof raw === 'string' ? raw : raw == null ? String(def.def) : String(raw);
  }
}

/** Значения по умолчанию для набора описаний. */
export function defaultValues(defs: PropDef[]): PropValues {
  const out: PropValues = {};
  for (const d of defs) out[d.key] = d.def;
  return out;
}

/** Приводит произвольный объект к валидным значениям: лишние ключи выбрасывает, недостающие — заполняет дефолтами. */
export function coerceProps(defs: PropDef[], raw: unknown): PropValues {
  const src = raw && typeof raw === 'object' ? (raw as PropValues) : {};
  const out: PropValues = {};
  for (const d of defs) out[d.key] = d.def;
  for (const d of defs) {
    if (Object.prototype.hasOwnProperty.call(src, d.key)) out[d.key] = coerceProp(d, src[d.key]);
  }
  return out;
}

/** Объединяет наборы значений: base + overrides (побеждает второй). */
export function mergePropValues(base: PropValues, overrides: PropValues | undefined): PropValues {
  return { ...base, ...(overrides ?? {}) };
}

export function propLabel(defs: PropDef[], key: string): string {
  return defs.find((d) => d.key === key)?.label ?? key;
}

export function groupDefs(defs: PropDef[]): { group: string; defs: PropDef[] }[] {
  const map = new Map<string, PropDef[]>();
  for (const d of defs) {
    const g = d.group ?? '';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(d);
  }
  return Array.from(map.entries()).map(([group, list]) => ({ group, defs: list }));
}