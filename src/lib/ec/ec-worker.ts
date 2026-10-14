import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import wasmUrl from "wa-sqlite/dist/wa-sqlite.wasm?url";
import * as SQLite from "wa-sqlite";
import { EcDatabase, type EcFilter } from "./ec-engine";

/** Worker: abre o .db3 do En Croissant sem carregá-lo na memória e responde às consultas da tela. */

declare class FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
}

export type EcRequest =
  | { id: number; type: "open"; file: File }
  | { id: number; type: "ids"; kind: "players" | "events"; text: string }
  | { id: number; type: "page"; filter: EcFilter; afterId: number; untilId: number; limit: number }
  | { id: number; type: "pageByPlayerIndex"; filter: EcFilter; afterId: number; limit: number }
  | { id: number; type: "suggest"; text: string; limit: number }
  | { id: number; type: "count"; ids: number[]; side?: "white" | "black" }
  | { id: number; type: "game"; rowId: number; maxPlies?: number }
  | { id: number; type: "close" };

const ctx = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<EcRequest>) => void) | null };

let sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
let database: EcDatabase | null = null;

async function engine() {
  if (!sqlite3) {
    const module = await SQLiteESMFactory({ locateFile: () => wasmUrl });
    sqlite3 = SQLite.Factory(module as Parameters<typeof SQLite.Factory>[0]);
  }
  return sqlite3;
}

async function handle(request: EcRequest): Promise<unknown> {
  switch (request.type) {
    case "open": {
      if (database) await database.close();
      database = null;
      const api = await engine();
      const sync = new FileReaderSync();
      const file = request.file;
      const reader = { size: file.size, read: (offset: number, length: number) => new Uint8Array(sync.readAsArrayBuffer(file.slice(offset, offset + length))) };
      const opened = await EcDatabase.open(api as never, reader, "banco.db3");
      if ("ec" in opened) return opened;
      database = opened;
      return { ec: true, info: opened.info };
    }
    case "ids":
      return database ? database.ids(request.kind, request.text) : [];
    case "page":
      return database ? database.page(request.filter, request.afterId, request.untilId, request.limit) : [];
    case "pageByPlayerIndex":
      return database ? database.pageByPlayerIndex(request.filter, request.afterId, request.limit) : [];
    case "suggest":
      return database ? database.suggestPlayers(request.text, request.limit) : [];
    case "count":
      return database ? database.countPlayerGames(request.ids, request.side) : null;
    case "game":
      return database ? database.loadGame(request.rowId, request.maxPlies) : null;
    case "close":
      if (database) await database.close();
      database = null;
      return true;
  }
}

ctx.onmessage = (event) => {
  const request = event.data;
  handle(request).then(
    (value) => ctx.postMessage({ id: request.id, ok: true, value }),
    (error: unknown) => ctx.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
