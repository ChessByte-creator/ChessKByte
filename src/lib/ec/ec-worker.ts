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
  | { id: number; type: "diagnose"; file: File }
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

/** Passo a passo do que o aparelho consegue fazer, para descobrir por que um arquivo não abre. */
async function diagnose(file: File) {
  const out: Record<string, string | number | boolean> = {
    webassembly: typeof WebAssembly === "object",
    fileReaderSync: typeof FileReaderSync !== "undefined",
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || "(sem tipo)",
  };
  try {
    const sync = new FileReaderSync();
    const head = new Uint8Array(sync.readAsArrayBuffer(file.slice(0, 16)));
    out.header = String.fromCharCode(...head.slice(0, 15));
    out.readOk = head.length > 0;
    if (file.size > 4096) {
      const tail = new Uint8Array(sync.readAsArrayBuffer(file.slice(file.size - 16, file.size)));
      out.readEndOk = tail.length > 0;
    }
  } catch (error) {
    out.readOk = false;
    out.readError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  try {
    await engine();
    out.engine = "ok";
  } catch (error) {
    out.engine = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return out;
}

async function handle(request: EcRequest): Promise<unknown> {
  switch (request.type) {
    case "diagnose":
      return diagnose(request.file);
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
