import { GAME_STORE, openByteDb } from "@/lib/byte-db";
import type { OpeningKind } from "@/lib/openings";

export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export type GameRecord = {
  id?: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  maxElo: number;
  result: GameResult;
  year: number;
  event: string;
  site: string;
  timeControl: string;
  termination: string;
  eco: string;
  opening: string;
  family: string;
  kind: OpeningKind;
  /** Categorias para busca: tipo da abertura e "gambit" quando há gambito no nome. */
  cat: string[];
  /** Nomes dos jogadores em minúsculas, para busca por prefixo. */
  players: string[];
  plies: number;
  /** Lances em SAN, separados por espaço, sem números. */
  moves: string;
  source: string;
};

export type GameFilters = {
  player?: string;
  family?: string;
  eco?: string;
  kind?: OpeningKind | "gambit" | "all";
  result?: GameResult | "all";
  minElo?: number;
  yearFrom?: number;
  yearTo?: number;
  minPlies?: number;
  maxPlies?: number;
  text?: string;
  source?: string;
};

export type GameSearch = { rows: GameRecord[]; hasMore: boolean; scanned: number; truncated: boolean };

const BATCH_SCAN_LIMIT = 400_000;

export async function putGames(games: GameRecord[]) {
  if (games.length === 0) return;
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(GAME_STORE, "readwrite");
      const store = tx.objectStore(GAME_STORE);
      for (const game of games) store.add(game);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Importação interrompida."));
    });
  } finally {
    db.close();
  }
}

export async function countGames(): Promise<number> {
  const db = await openByteDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function clearGames() {
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(GAME_STORE, "readwrite").objectStore(GAME_STORE).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export type SourceInfo = { name: string; games: number };

export async function listSources(): Promise<SourceInfo[]> {
  const db = await openByteDb();
  try {
    const names = await new Promise<string[]>((resolve, reject) => {
      const found: string[] = [];
      const request = db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE).index("source").openKeyCursor(null, "nextunique");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(found);
          return;
        }
        found.push(String(cursor.key));
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    const out: SourceInfo[] = [];
    for (const name of names) {
      const games = await new Promise<number>((resolve, reject) => {
        const request = db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE).index("source").count(IDBKeyRange.only(name));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      out.push({ name, games });
    }
    return out;
  } finally {
    db.close();
  }
}

export async function deleteSource(name: string) {
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(GAME_STORE, "readwrite");
      const request = tx.objectStore(GAME_STORE).index("source").openKeyCursor(IDBKeyRange.only(name));
      const store = tx.objectStore(GAME_STORE);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(game: GameRecord, f: GameFilters, text: string) {
  if (f.player) {
    const q = norm(f.player);
    if (!game.players.some((name) => name.includes(q))) return false;
  }
  if (f.family && game.family !== f.family) return false;
  if (f.eco && !game.eco.startsWith(f.eco.toUpperCase())) return false;
  if (f.kind && f.kind !== "all" && !game.cat.includes(f.kind)) return false;
  if (f.result && f.result !== "all" && game.result !== f.result) return false;
  if (f.minElo && game.maxElo < f.minElo) return false;
  if (f.yearFrom && game.year < f.yearFrom) return false;
  if (f.yearTo && game.year > f.yearTo) return false;
  if (f.minPlies && game.plies < f.minPlies) return false;
  if (f.maxPlies && game.plies > f.maxPlies) return false;
  if (f.source && game.source !== f.source) return false;
  if (text && !norm(`${game.opening} ${game.eco} ${game.event} ${game.white} ${game.black}`).includes(text)) return false;
  return true;
}

/** Escolhe o índice mais seletivo como motor da busca; o resto dos filtros é aplicado em seguida. */
function driver(f: GameFilters): { index: string | null; range: IDBKeyRange | null } {
  if (f.player) {
    const q = norm(f.player);
    return { index: "players", range: IDBKeyRange.bound(q, `${q}\uffff`) };
  }
  if (f.family) return { index: "family", range: IDBKeyRange.only(f.family) };
  if (f.eco) {
    const eco = f.eco.toUpperCase();
    return { index: "eco", range: IDBKeyRange.bound(eco, `${eco}\uffff`) };
  }
  if (f.kind && f.kind !== "all") return { index: "cat", range: IDBKeyRange.only(f.kind) };
  if (f.source) return { index: "source", range: IDBKeyRange.only(f.source) };
  if (f.result && f.result !== "all") return { index: "result", range: IDBKeyRange.only(f.result) };
  if (f.yearFrom || f.yearTo) return { index: "year", range: IDBKeyRange.bound(f.yearFrom ?? 0, f.yearTo ?? 9999) };
  if (f.minElo) return { index: "maxElo", range: IDBKeyRange.lowerBound(f.minElo) };
  return { index: null, range: null };
}

/** Busca com paginação por deslocamento. Varre no máximo ~400 mil registros por consulta. */
export async function searchGames(filters: GameFilters, offset: number, limit: number): Promise<GameSearch> {
  const db = await openByteDb();
  try {
    const { index, range } = driver(filters);
    const text = filters.text ? norm(filters.text.trim()) : "";
    return await new Promise<GameSearch>((resolve, reject) => {
      const store = db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE);
      const request = (index ? store.index(index) : store).openCursor(range);
      const rows: GameRecord[] = [];
      let skipped = 0;
      let scanned = 0;
      const seen = new Set<number>();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ rows, hasMore: false, scanned, truncated: false });
          return;
        }
        scanned += 1;
        const game = cursor.value as GameRecord;
        // O índice "players" pode devolver a mesma partida duas vezes (brancas e pretas).
        const dup = game.id != null && seen.has(game.id);
        if (!dup && matches(game, filters, text)) {
          if (game.id != null) seen.add(game.id);
          if (skipped < offset) skipped += 1;
          else if (rows.length < limit) rows.push(game);
          else {
            resolve({ rows, hasMore: true, scanned, truncated: false });
            return;
          }
        }
        if (scanned >= BATCH_SCAN_LIMIT) {
          resolve({ rows, hasMore: rows.length >= limit, scanned, truncated: true });
          return;
        }
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
}

/** Famílias de abertura mais frequentes no repositório (para o filtro rápido). */
export async function topFamilies(limit = 40): Promise<Array<{ family: string; games: number }>> {
  const db = await openByteDb();
  try {
    const counts = new Map<string, number>();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE).index("family").openKeyCursor();
      let n = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || n > 300_000) {
          resolve();
          return;
        }
        n += 1;
        const key = String(cursor.key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return [...counts.entries()]
      .filter(([family]) => family)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([family, games]) => ({ family, games }));
  } finally {
    db.close();
  }
}
