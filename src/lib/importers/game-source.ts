import type { GameFilters, GameRecord } from "@/lib/games-db";
import type { Ply } from "@/lib/game";
import { EcSource } from "@/lib/ec/ec-source";
import { GameStream } from "@/lib/importers/game-stream";
import { sniffFormat } from "@/lib/importers/sources";
import type { OpeningsIndex } from "@/lib/openings";

export type PlayerSuggestion = { id: number; name: string; elo: number };

/** Qualquer arquivo de partidas lido sob demanda (PGN comprimido, .db genérico ou banco do En Croissant). */
export interface GameSource {
  scanned: number;
  done: boolean;
  percent: number;
  readonly format: string;
  take(
    count: number,
    filters: GameFilters,
    signal?: AbortSignal,
    onScan?: (scanned: number, percent: number) => void,
    /** Chamado assim que partidas que passam nos filtros são achadas (a página ainda não está completa). */
    onFound?: (rows: GameRecord[]) => void,
  ): Promise<GameRecord[]>;
  /** Nome do tipo de filtro que usa índice no arquivo, se houver (só para avisar o jogador). */
  readonly playerIndexed?: boolean;
  /** Sugestões de jogadores pelo nome (só o banco do En Croissant tem a lista de jogadores). */
  suggestPlayers?(text: string): Promise<PlayerSuggestion[]>;
  /** Total de partidas do jogador, quando dá para saber sem varrer o arquivo. */
  playerCount?(filters: GameFilters): Promise<number | null>;
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
