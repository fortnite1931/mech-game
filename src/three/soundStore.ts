/**
 * Хранилище загруженных звуков в IndexedDB.
 * localStorage не подходит: файлы весят мегабайты и быстро упираются в квоту ~5 МБ.
 */

const DB_NAME = 'wasteland-forge-sounds';
const DB_VERSION = 1;
const STORE = 'sounds';

export interface StoredSound {
  id: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
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
    } catch {
      resolve(null);
    }
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function putSound(sound: StoredSound): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const stored = await wrap(tx(db, 'readwrite').put(sound));
  db.close();
  return !!stored;
}

export async function getSound(id: string): Promise<StoredSound | null> {
  const db = await openDb();
  if (!db) return null;
  const res = await wrap(tx(db, 'readonly').get(id)) as StoredSound | null;
  db.close();
  return res;
}

export async function listSounds(): Promise<StoredSound[]> {
  const db = await openDb();
  if (!db) return [];
  const res = (await wrap(tx(db, 'readonly').getAll())) as StoredSound[] | null;
  db.close();
  return res ?? [];
}

export async function deleteSound(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  await wrap(tx(db, 'readwrite').delete(id));
  db.close();
  return true;
}

/** base64 для экспорта проекта. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}