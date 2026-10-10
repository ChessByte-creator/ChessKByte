import { putPuzzles } from "@/lib/puzzle-db";
import { normalizePuzzle, parsePuzzleDocument, puzzleFromHeader, puzzleFromLoose, splitCsv, type Puzzle } from "@/lib/puzzles";
import { decodedChunks, sniffFormat, textLines, type FileFormat } from "@/lib/importers/sources";
import { iterateRows, listTables, openSqlite, pickColumn } from "@/lib/importers/sqlite";

export type ImportOptions = {
  /** Para depois de importar essa quantidade (0 = tudo). */
  maxPuzzles?: number;
  signal?: AbortSignal;
  onProgress?: (state: { added: number; skipped: number; percent: number; phase: string }) => void;
};

export type ImportResult = { added: number; skipped: number; format: FileFormat; stopped: boolean };

const BATCH = 4000;
const JSON_LIMIT = 200_000_000;

/** Importa puzzles de CSV/TSV/JSON, em .zst, .gz ou texto puro, e de bancos SQLite (.db). Sem limite de tamanho (exceto JSON e SQLite). */
export async function importPuzzleFile(file: File, options: ImportOptions = {}): Promise<ImportResult> {
  const format = await sniffFormat(file);
  const { signal, onProgress } = options;
  const max = options.maxPuzzles ?? 0;
  let added = 0;
  let skipped = 0;
  let stopped = false;
  let pending: Puzzle[] = [];

  const report = (percent: number, phase: string) => onProgress?.({ added, skipped, percent, phase });
  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await putPuzzles(batch);
    added += batch.length;
  };
  const push = async (puzzle: Puzzle | null) => {
    if (!puzzle) {
      skipped += 1;
      return;
    }
    pending.push(puzzle);
    if (pending.length >= BATCH) await flush();
  };
  const full = () => max > 0 && added + pending.length >= max;

  if (format === "sqlite") {
    report(0, "Abrindo o banco SQLite…");
    const db = await openSqlite(file);
    try {
      const tables = listTables(db);
      const table = tables.find((item) => pickColumn(item.columns, ["fen"]) && pickColumn(item.columns, ["moves", "solution", "line"]));
      if (!table) throw new Error("Não achei uma tabela com colunas de FEN e lances.");
      const cols = {
        id: pickColumn(table.columns, ["puzzleid", "puzzle_id", "id"]),
        fen: pickColumn(table.columns, ["fen"]) as string,
        moves: pickColumn(table.columns, ["moves", "solution", "line"]) as string,
        rating: pickColumn(table.columns, ["rating", "elo"]),
        themes: pickColumn(table.columns, ["themes", "theme", "tags"]),
      };
      const names = Object.values(cols).filter((name): name is string => Boolean(name));
      let seen = 0;
      for (const rows of iterateRows(db, table.name, names)) {
        if (signal?.aborted) {
          stopped = true;
          break;
        }
        for (const row of rows) {
          await push(
            normalizePuzzle(
              {
                id: cols.id ? String(row[cols.id] ?? "") : "",
                fen: String(row[cols.fen] ?? ""),
                moves: String(row[cols.moves] ?? ""),
                rating: cols.rating ? row[cols.rating] : 1200,
                themes: cols.themes ? String(row[cols.themes] ?? "") : "",
              },
              false,
            ),
          );
          if (full()) break;
        }
        seen += rows.length;
        report(table.rows ? Math.min(99, (seen / table.rows) * 100) : 0, "Lendo puzzles…");
        await flush();
        if (full()) {
          stopped = true;
          break;
        }
      }
    } finally {
      db.close();
    }
    await flush();
    return { added, skipped, format, stopped };
  }

  if (format === "zip" || format === "bzip2") throw new Error(format === "zip" ? "Extraia o .zip antes de importar." : "Arquivos .bz2 não são suportados. Use .zst ou .gz.");

  // JSON precisa ser lido inteiro; fica limitado.
  const peek = decodedChunks(file, format);
  const firstChunk = (await peek.next()).value as Uint8Array | undefined;
  await peek.return(undefined);
  const first = new TextDecoder().decode(firstChunk ?? new Uint8Array());
  const lead = first.trimStart()[0];
  if (lead === "{" || lead === "[") {
    if (file.size > JSON_LIMIT) throw new Error("JSON muito grande. Use o CSV da Lichess (aceita .zst).");
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of decodedChunks(file, format, (read, total) => report((read / total) * 90, "Lendo JSON…"), signal)) chunks.push(decoder.decode(chunk, { stream: true }));
    chunks.push(decoder.decode());
    const parsed = parsePuzzleDocument(chunks.join(""));
    skipped += parsed.skipped;
    pending = max > 0 ? parsed.puzzles.slice(0, max) : parsed.puzzles;
    await flush();
    return { added, skipped, format, stopped: false };
  }

  const check = file.size < 5_000_000;
  let header: string[] | null = null;
  for await (const line of textLines(file, format, (read, total) => report(total ? (read / total) * 100 : 0, "Importando puzzles…"), signal)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const cells = splitCsv(line);
    if (!header && cells.some((cell) => /^(puzzleid|fen|moves|rating|themes)$/i.test(cell.trim()))) {
      header = cells.map((cell) => cell.trim().toLowerCase());
      continue;
    }
    await push(header ? puzzleFromHeader(header, cells, check) : puzzleFromLoose(cells));
    if (full()) {
      stopped = true;
      break;
    }
  }
  if (signal?.aborted) stopped = true;
  await flush();
  return { added, skipped, format, stopped };
}
