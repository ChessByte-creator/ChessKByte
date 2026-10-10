/** Banco local do Byte Chess (IndexedDB): puzzles e repositório de partidas. */
export const BYTE_DB = "byte-chess";
export const BYTE_DB_VERSION = 1;
export const PUZZLE_STORE = "puzzles";
export const GAME_STORE = "games";

const LEGACY_DB = "grok-chess-puzzles";
const MIGRATED_KEY = "byte-chess-legacy-migrated";

let migration: Promise<void> | null = null;

function rawOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BYTE_DB, BYTE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PUZZLE_STORE)) {
        const store = db.createObjectStore(PUZZLE_STORE, { keyPath: "id" });
        store.createIndex("rating", "rating", { unique: false });
        // "tema|rating com 4 dígitos": permite sortear por tema e faixa de rating sem varrer tudo.
        store.createIndex("tr", "tr", { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains(GAME_STORE)) {
        const store = db.createObjectStore(GAME_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("family", "family", { unique: false });
        store.createIndex("eco", "eco", { unique: false });
        store.createIndex("result", "result", { unique: false });
        store.createIndex("year", "year", { unique: false });
        store.createIndex("maxElo", "maxElo", { unique: false });
        store.createIndex("source", "source", { unique: false });
        store.createIndex("cat", "cat", { unique: false, multiEntry: true });
        store.createIndex("players", "players", { unique: false, multiEntry: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir a base local."));
  });
}

export function ratingKey(theme: string, rating: number) {
  return `${theme}|${String(Math.max(0, Math.min(9999, Math.round(rating)))).padStart(4, "0")}`;
}

/** Abre o banco e, uma única vez, traz os puzzles da base antiga (Grok Chess). */
export async function openByteDb(): Promise<IDBDatabase> {
  const db = await rawOpen();
  if (!migration) migration = migrateLegacy(db).catch(() => undefined);
  await migration;
  return db;
}

async function migrateLegacy(target: IDBDatabase) {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }
  const list = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  if (!list.some((item) => item.name === LEGACY_DB)) {
    markMigrated();
    return;
  }
  const old = await new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(LEGACY_DB);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  if (!old) return;
  try {
    if (old.objectStoreNames.contains(PUZZLE_STORE)) {
      await new Promise<void>((resolve, reject) => {
        const read = old.transaction(PUZZLE_STORE, "readonly").objectStore(PUZZLE_STORE).openCursor();
        let batch: Array<Record<string, unknown>> = [];
        const flush = (done: boolean) => {
          const rows = batch;
          batch = [];
          const tx = target.transaction(PUZZLE_STORE, "readwrite");
          const store = tx.objectStore(PUZZLE_STORE);
          for (const row of rows) {
            const themes = Array.isArray(row.themes) ? (row.themes as string[]) : [];
            store.put({ ...row, tr: ["all", ...themes].map((theme) => ratingKey(theme, Number(row.rating) || 0)) });
          }
          tx.onerror = () => reject(tx.error);
          return new Promise<void>((ok) => {
            tx.oncomplete = () => ok();
          }).then(() => {
            if (done) resolve();
          });
        };
        read.onsuccess = () => {
          const cursor = read.result;
          if (cursor) {
            batch.push(cursor.value as Record<string, unknown>);
            if (batch.length >= 2000) void flush(false).then(() => cursor.continue());
            else cursor.continue();
          } else {
            void flush(true);
          }
        };
        read.onerror = () => reject(read.error);
      });
    }
  } finally {
    old.close();
  }
  indexedDB.deleteDatabase(LEGACY_DB);
  markMigrated();
}

function markMigrated() {
  try {
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    /* ignore */
  }
}
