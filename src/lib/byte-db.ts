/** Banco local do Byte Chess (IndexedDB): repositório de partidas importadas e análises salvas. */
export const BYTE_DB = "byte-chess";
export const BYTE_DB_VERSION = 3;
export const GAME_STORE = "games";
export const ANALYSIS_STORE = "analyses";

/** Bancos e tabelas de versões antigas, apagados na abertura (os puzzles agora são lidos sob demanda). */
const LEGACY_DB = "grok-chess-puzzles";
const LEGACY_PUZZLE_STORE = "puzzles";

function rawOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BYTE_DB, BYTE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(LEGACY_PUZZLE_STORE)) db.deleteObjectStore(LEGACY_PUZZLE_STORE);
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
      if (!db.objectStoreNames.contains(ANALYSIS_STORE)) {
        const store = db.createObjectStore(ANALYSIS_STORE, { keyPath: "key" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error("Feche as outras abas do Byte Chess para atualizar a base local."));
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir a base local."));
  });
}

let cleaned = false;

export async function openByteDb(): Promise<IDBDatabase> {
  const db = await rawOpen();
  if (!cleaned) {
    cleaned = true;
    try {
      indexedDB.deleteDatabase(LEGACY_DB);
    } catch {
      /* ignore */
    }
  }
  return db;
}
