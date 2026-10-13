import type { GameFilters, GameRecord } from "@/lib/games-db";
import type { Ply } from "@/lib/game";
import { EcSource } from "@/lib/ec/ec-source";
import { GameStream } from "@/lib/importers/game-stream";
import { sniffFormat } from "@/lib/importers/sources";
import type { OpeningsIndex } from "@/lib/openings";

/** Qualquer arquivo de partidas lido sob demanda (PGN comprimido, .db genérico ou banco do En Croissant). */
export interface GameSource {
  scanned: number;
  done: boolean;
  percent: number;
  readonly format: string;
  take(count: number, filters: GameFilters, signal?: AbortSignal, onScan?: (scanned: number, percent: number) => void): Promise<GameRecord[]>;
  restart(): void;
  close(): void;
  /** Só nas fontes que guardam os lances em formato binário (En Croissant): decodifica ao abrir a partida. */
  loadPlies?(game: GameRecord): Promise<Ply[] | null>;
}

export type OpenedSource = { source: GameSource; label: string; warning?: string };

export async function openGameSource(file: File, openings: OpeningsIndex | null): Promise<OpenedSource> {
  const format = await sniffFormat(file);
  if (format === "sqlite") {
    const ec = await EcSource.open(file, openings);
    if (ec) return { source: ec.source, label: "banco do En Croissant", warning: ec.warning };
  }
  const stream = await GameStream.open(file, openings);
  return { source: stream, label: stream.format };
}
