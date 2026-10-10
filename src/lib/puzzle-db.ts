import type { Puzzle } from "@/lib/puzzles";
import { PUZZLE_STORE, openByteDb, ratingKey } from "@/lib/byte-db";

type StoredPuzzle = Puzzle & { tr: string[] };

export async function countPuzzles() {
  const db = await openByteDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(PUZZLE_STORE, "readonly").objectStore(PUZZLE_STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function clearPuzzles() {
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(PUZZLE_STORE, "readwrite").objectStore(PUZZLE_STORE).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function withKeys(puzzle: Puzzle): StoredPuzzle {
  return { ...puzzle, tr: ["all", ...new Set(puzzle.themes)].map((theme) => ratingKey(theme, puzzle.rating)) };
}

export async function putPuzzles(puzzles: Puzzle[]) {
  if (puzzles.length === 0) return;
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PUZZLE_STORE, "readwrite");
      const store = tx.objectStore(PUZZLE_STORE);
      for (const puzzle of puzzles) store.put(withKeys(puzzle));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Importação interrompida."));
    });
  } finally {
    db.close();
  }
}

export async function randomNear(rating: number, avoid: Set<string>, theme: string): Promise<Puzzle | null> {
  const db = await openByteDb();
  try {
    const key = theme || "all";
    for (const span of [250, 550, 1200, 4000]) {
      const found = await sample(db, key, Math.max(0, rating - span), rating + span, avoid);
      if (found) return found;
    }
    return null;
  } finally {
    db.close();
  }
}

function strip(row: StoredPuzzle): Puzzle {
  const { tr: _tr, ...puzzle } = row;
  void _tr;
  return puzzle;
}

function sample(db: IDBDatabase, theme: string, min: number, max: number, avoid: Set<string>) {
  const range = IDBKeyRange.bound(ratingKey(theme, min), ratingKey(theme, max));
  return new Promise<Puzzle | null>((resolve, reject) => {
    const index = db.transaction(PUZZLE_STORE, "readonly").objectStore(PUZZLE_STORE).index("tr");
    const countRequest = index.count(range);
    countRequest.onerror = () => reject(countRequest.error);
    countRequest.onsuccess = () => {
      const total = countRequest.result;
      if (total === 0) {
        resolve(null);
        return;
      }
      let skip = Math.floor(Math.random() * total);
      const request = db.transaction(PUZZLE_STORE, "readonly").objectStore(PUZZLE_STORE).index("tr").openCursor(range);
      let tries = 0;
      let fallback: Puzzle | null = null;
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || tries > 60) {
          resolve(fallback);
          return;
        }
        if (skip > 0) {
          const jump = Math.min(skip, 500);
          skip -= jump;
          cursor.advance(jump);
          return;
        }
        const puzzle = strip(cursor.value as StoredPuzzle);
        if (!avoid.has(puzzle.id)) {
          resolve(puzzle);
          return;
        }
        fallback ??= puzzle;
        tries += 1;
        cursor.continue();
      };
    };
  });
}
