import type { Ply } from "@/lib/game";
import type { EcFilter, EcInfo, EcRow, NotEc, PlayerHit } from "./ec-engine";
import type { EcRequest } from "./ec-worker";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

/** Fala com o Worker que lê o .db3. Uma instância por arquivo aberto. */
export class EcClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;

  constructor() {
    this.worker = new Worker(new URL("./ec-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.value);
      else entry.reject(new Error(event.data.error || "Falha ao ler o banco."));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "O leitor de bancos não iniciou.");
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  /** `timeoutMs`: se o Worker não responder nesse tempo, a chamada falha em vez de ficar "carregando" para sempre. */
  private call<T>(request: Distribute<EcRequest>, timeoutMs = 0): Promise<T> {
    const id = (this.seq += 1);
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0 ? window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("O leitor de arquivos não respondeu (tempo esgotado)."));
      }, timeoutMs) : 0;
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      });
      this.worker.postMessage({ ...request, id });
    });
  }

  open(file: File) {
    return this.call<{ ec: true; info: EcInfo } | NotEc>({ type: "open", file }, 120_000);
  }

  /** Relatório do que este aparelho consegue fazer com o arquivo (para mostrar na tela quando algo falha). */
  diagnose(file: File) {
    return this.call<Record<string, string | number | boolean>>({ type: "diagnose", file }, 20_000);
  }

  ids(kind: "players" | "events", text: string) {
    return this.call<number[]>({ type: "ids", kind, text });
  }

  page(filter: EcFilter, afterId: number, untilId: number, limit: number) {
    return this.call<EcRow[]>({ type: "page", filter, afterId, untilId, limit });
  }

  pageByPlayerIndex(filter: EcFilter, afterId: number, limit: number) {
    return this.call<EcRow[]>({ type: "pageByPlayerIndex", filter, afterId, limit });
  }

  suggest(text: string, limit = 8) {
    return this.call<PlayerHit[]>({ type: "suggest", text, limit }, 30_000);
  }

  count(ids: number[], side?: "white" | "black") {
    return this.call<number | null>({ type: "count", ids, side });
  }

  game(rowId: number, maxPlies?: number) {
    return this.call<{ plies: Ply[]; san: string; ok: boolean } | null>({ type: "game", rowId, maxPlies });
  }

  close() {
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(new Error("Arquivo fechado."));
    this.pending.clear();
  }
}
