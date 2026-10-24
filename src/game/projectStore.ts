/**
 * Хранилище проектов в IndexedDB — аналог файлов проекта в Construct 3.
 *
 * Почему не localStorage: квота ~5 МБ, а проект со встроенными звуками
 * (base64) весит десятки мегабайт. IndexedDB держит сотни МБ и переживает
 * перезагрузку страницы без ручной перенастройки.
 *
 * Возможности:
 *  - несколько именованных проектов (слоты);
 *  - отдельный слот автосохранения (восстанавливается при следующем запуске);
 *  - полный JSON проекта, включая звуки и всю логику.
 */

const DB_NAME = 'wasteland-forge-projects';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTO_ID = '__autosave__';

export interface StoredProject {
  id: string;
  name: string;
  json: string;
  updatedAt: number;
  /** Кол-во звуков внутри — для показа в списке. */
  sounds: number;
  objects: number;
  bytes: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

function countSounds(json: string): number {
  try {
    const data = JSON.parse(json) as { sounds?: unknown[] };
    return Array.isArray(data.sounds) ? data.sounds.length : 0;
  } catch {
    return 0;
  }
}

function countObjects(json: string): number {
  try {
    const data = JSON.parse(json) as { objects?: unknown[] };
    return Array.isArray(data.objects) ? data.objects.length : 0;
  } catch {
    return 0;
  }
}

/** Сохранить проект под именем (id = имя). Перезаписывает слот. */
export async function saveProject(id: string, name: string, json: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const rec: StoredProject = {
    id,
    name: name || id,
    json,
    updatedAt: Date.now(),
    sounds: countSounds(json),
    objects: countObjects(json),
    bytes: json.length,
  };
  const res = await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec));
  db.close();
  return res !== null;
}

/** Загрузить проект по id. */
export async function loadProject(id: string): Promise<StoredProject | null> {
  const db = await openDb();
  if (!db) return null;
  const res = (await done(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as StoredProject | null;
  db.close();
  return res ?? null;
}

/** Список всех проектов, свежие сверху. Автослот в список не входит. */
export async function listProjects(): Promise<StoredProject[]> {
  const db = await openDb();
  if (!db) return [];
  const all = (await done(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as StoredProject[] | null;
  db.close();
  return (all ?? [])
    .filter((p) => p.id !== AUTO_ID)
    .map((p) => ({ ...p, json: '' }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Удалить проект по id (автослот удалить нельзя). */
export async function deleteProject(id: string): Promise<boolean> {
  if (id === AUTO_ID) return false;
  const db = await openDb();
  if (!db) return false;
  const res = await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  db.close();
  return res !== undefined;
}

/** Записать автосохранение (перезаписывает слот). */
export async function saveAutosave(json: string, name = 'автосохранение'): Promise<boolean> {
  return saveProject(AUTO_ID, name, json);
}

/** Забрать автосохранение (для восстановления при следующем запуске). */
export async function loadAutosave(): Promise<StoredProject | null> {
  return loadProject(AUTO_ID);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
