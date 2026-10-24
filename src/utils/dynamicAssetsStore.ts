/** Хранение импортированных GLB-ассетов (base64) — переживают перезагрузку и новые вкладки. */

export interface StoredDynamicAsset {
  id: string;
  name: string;
  base64: string;
}

const KEY = "wf_dynamic_assets";

export function saveDynamicAssets(list: StoredDynamicAsset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

export function loadDynamicAssets(): StoredDynamicAsset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string" && typeof a.base64 === "string") : [];
  } catch {
    return [];
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[]);
  }
  return btoa(bin);
}
