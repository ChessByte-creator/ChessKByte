import { ANALYSIS_STORE, openByteDb } from "@/lib/byte-db";
import type { ReviewState } from "@/lib/review";
import { sanitizeShapes, type Shape } from "@/lib/shapes";

export type AnalysisRecord = {
  key: string;
  savedAt: number;
  startFen: string;
  pgn: string;
  review: Omit<ReviewState, "key"> | null;
  /** Desenhos do usuário por posição (FEN). */
  shapes: Record<string, Shape[]>;
};

const MAX_RECORDS = 40;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAnalysis(record: AnalysisRecord) {
  const db = await openByteDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_STORE, "readwrite");
      tx.objectStore(ANALYSIS_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    await prune(db);
  } finally {
    db.close();
  }
}

export async function loadAnalysis(key: string): Promise<AnalysisRecord | null> {
  const db = await openByteDb();
  try {
    const found = await request(db.transaction(ANALYSIS_STORE, "readonly").objectStore(ANALYSIS_STORE).get(key));
    if (!found) return null;
    const record = found as AnalysisRecord;
    const shapes: Record<string, Shape[]> = {};
    for (const [fen, list] of Object.entries(record.shapes ?? {})) shapes[fen] = sanitizeShapes(list);
    return { ...record, shapes };
  } finally {
    db.close();
  }
}

export async function deleteAnalysis(key: string) {
  const db = await openByteDb();
  try {
    await request(db.transaction(ANALYSIS_STORE, "readwrite").objectStore(ANALYSIS_STORE).delete(key));
  } finally {
    db.close();
  }
}

/** Mantém só as análises mais recentes, para não crescer sem limite. */
async function prune(db: IDBDatabase) {
  const total = await request(db.transaction(ANALYSIS_STORE, "readonly").objectStore(ANALYSIS_STORE).count());
  if (total <= MAX_RECORDS) return;
  let excess = total - MAX_RECORDS;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ANALYSIS_STORE, "readwrite");
    const store = tx.objectStore(ANALYSIS_STORE);
    const cursorRequest = store.index("savedAt").openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
