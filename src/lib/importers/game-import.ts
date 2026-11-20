import { putGames, type GameRecord } from "@/lib/games-db";
import { buildGame, splitPgn, splitPgnAsync, type PgnGame } from "@/lib/importers/pgn";
import { sniffFormat, textLines, type FileFormat } from "@/lib/importers/sources";
import { iterateRows, listTables, openSqlite, pickColumn } from "@/lib/importers/sqlite";
import type { OpeningsIndex } from "@/lib/openings";

export type GameImportOptions = {
  openings: OpeningsIndex | null;
  /** Nome do lote (normalmente o nome do arquivo); permite apagar só esse lote depois. */
  source: string;
  /** Para depois dessa quantidade de partidas aceitas (0 = tudo). */
  maxGames?: number;
  /** Só aceita partidas em que o jogador mais forte tenha pelo menos esse rating. */
  minElo?: number;
  signal?: AbortSignal;
  onProgress?: (state: { added: number; skipped: number; percent: number; phase: string }) => void;
};

export type GameImportResult = { added: number; skipped: number; format: FileFormat; stopped: boolean };

const BATCH = 1000;

/** Importa partidas de PGN (texto, .zst ou .gz) e de bancos SQLite (.db). PGN é lido em streaming, sem limite de tamanho. */
export async function importGameFile(file: File, options: GameImportOptions): Promise<GameImportResult> {
  const format = await sniffFormat(file);
  const { signal, onProgress } = options;
  const max = options.maxGames ?? 0;
  let added = 0;
  let skipped = 0;
  let stopped = false;
  let pending: GameRecord[] = [];

  const report = (percent: number, phase: string) => onProgress?.({ added, skipped, percent, phase });
  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await putGames(batch);
    added += batch.length;
    // cede o fluxo à interface entre os lotes
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const accept = async (game: PgnGame) => {
    const record = buildGame(game, { openings: options.openings, source: options.source });
    if (!record || (options.minElo && record.maxElo < options.minElo)) {
      skipped += 1;
      return;
    }
    pending.push(record);
    if (pending.length >= BATCH) await flush();
  };
  const full = () => max > 0 && added + pending.length >= max;

  if (format === "sqlite") {
    report(0, "Abrindo o banco SQLite…");
    const db = await openSqlite(file);
    try {
      const tables = listTables(db);
      const table =
        tables.find((item) => pickColumn(item.columns, ["pgn"])) ??
        tables.find((item) => pickColumn(item.columns, ["moves", "movetext"]) && pickColumn(item.columns, ["white"]));
      if (!table) throw new Error("Não achei uma tabela de partidas (coluna pgn, ou white + moves).");
      const pgnCol = pickColumn(table.columns, ["pgn"]);
      const fields: Record<string, string | null> = {
        White: pickColumn(table.columns, ["white", "whitename"]),
        Black: pickColumn(table.columns, ["black", "blackname"]),
        WhiteElo: pickColumn(table.columns, ["whiteelo", "white_elo", "welo"]),
        BlackElo: pickColumn(table.columns, ["blackelo", "black_elo", "belo"]),
        Result: pickColumn(table.columns, ["result"]),
        Date: pickColumn(table.columns, ["date", "utcdate"]),
        ECO: pickColumn(table.columns, ["eco"]),
        Opening: pickColumn(table.columns, ["opening", "openingname"]),
        Event: pickColumn(table.columns, ["event"]),
        Site: pickColumn(table.columns, ["site"]),
        TimeControl: pickColumn(table.columns, ["timecontrol"]),
        Termination: pickColumn(table.columns, ["termination"]),
      };
      const movesCol = pickColumn(table.columns, ["moves", "movetext"]);
      const names = [...new Set([pgnCol, movesCol, ...Object.values(fields)].filter((name): name is string => Boolean(name)))];
      let seen = 0;
      outer: for (const rows of iterateRows(db, table.name, names, 2000)) {
        if (signal?.aborted) {
          stopped = true;
          break;
        }
        for (const row of rows) {
          if (pgnCol && row[pgnCol]) {
            for (const game of splitPgn(String(row[pgnCol]).split(/\r?\n/))) await accept(game);
          } else if (movesCol) {
            const headers: Record<string, string> = {};
            for (const [tag, column] of Object.entries(fields)) if (column && row[column] != null) headers[tag] = String(row[column]);
            await accept({ headers, movetext: String(row[movesCol] ?? "") });
          }
          if (full()) {
            stopped = true;
            break outer;
          }
        }
        seen += rows.length;
        report(table.rows ? Math.min(99, (seen / table.rows) * 100) : 0, "Lendo partidas…");
        await flush();
      }
    } finally {
      db.close();
    }
    await flush();
    return { added, skipped, format, stopped };
  }

  if (format === "zip" || format === "bzip2") throw new Error(format === "zip" ? "Extraia o .zip antes de importar." : "Arquivos .bz2 não são suportados. Use .zst ou .gz.");

  const lines = textLines(file, format, (read, total) => report(total ? (read / total) * 100 : 0, "Importando partidas…"), signal);
  for await (const game of splitPgnAsync(lines)) {
    await accept(game);
    if (full()) {
      stopped = true;
      break;
    }
  }
  if (signal?.aborted) stopped = true;
  await flush();
  return { added, skipped, format, stopped };
}
