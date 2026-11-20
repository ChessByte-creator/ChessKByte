import { normalizePuzzle, parsePuzzleDocument, puzzleFromHeader, puzzleFromLoose, splitCsv, type Puzzle } from "@/lib/puzzles";
import { decodedChunks, sniffFormat, textLines, type FileFormat } from "@/lib/importers/sources";
import { iterateRows, listTables, openSqlite, pickColumn } from "@/lib/importers/sqlite";
import type { Database } from "sql.js";

export type PuzzleFilter = {
  minRating: number;
  maxRating: number;
  /** "all" ou o nome do tema da Lichess (ex.: "mateIn2"). */
  theme: string;
};

export function matchesFilter(puzzle: Puzzle, filter: PuzzleFilter) {
  if (puzzle.rating < filter.minRating || puzzle.rating > filter.maxRating) return false;
  return filter.theme === "all" || puzzle.themes.includes(filter.theme);
}

type Item = Puzzle | null;

const JSON_LIMIT = 200_000_000;

/**
 * Leitura sob demanda: o arquivo é percorrido só até achar os puzzles pedidos e fica "pausado" no ponto
 * onde parou. Cada `take` continua dali, sem reler nem guardar o arquivo inteiro.
 */
export class PuzzleStream {
  linesRead = 0;
  done = false;
  /** 0 a 100, estimado pelos bytes lidos do arquivo (o tamanho é o do arquivo comprimido). */
  percent = 0;
  readonly format: FileFormat;

  private iterator: AsyncIterator<Item>;
  private db: Database | null;

  private constructor(readonly file: File, format: FileFormat, iterator: AsyncIterator<Item>, db: Database | null) {
    this.format = format;
    this.iterator = iterator;
    this.db = db;
  }

  /** Abre o arquivo. `skipLines` retoma de uma leitura anterior (descomprime e descarta até lá, sem interpretar). */
  static async open(file: File, skipLines = 0): Promise<PuzzleStream> {
    const format = await sniffFormat(file);
    if (format === "zip" || format === "bzip2") throw new Error(format === "zip" ? "Extraia o .zip antes." : "Arquivos .bz2 não são suportados. Use .zst ou .gz.");
    let self: PuzzleStream | null = null;
    const bump = (read: number, total: number) => {
      if (self && total > 0) self.percent = Math.min(100, (read / total) * 100);
    };
    let db: Database | null = null;
    let iterator: AsyncIterator<Item>;

    if (format === "sqlite") {
      db = await openSqlite(file);
      iterator = sqliteItems(db, skipLines, () => self).call(null);
    } else {
      const head = decodedChunks(file, format);
      const first = (await head.next()).value as Uint8Array | undefined;
      await head.return(undefined);
      const lead = new TextDecoder().decode(first ?? new Uint8Array()).trimStart()[0];
      if (lead === "{" || lead === "[") {
        if (file.size > JSON_LIMIT) throw new Error("JSON muito grande. Use o CSV da Lichess (aceita .zst).");
        iterator = jsonItems(file, format, skipLines, () => self).call(null);
      } else {
        iterator = textItems(file, format, skipLines, bump, () => self).call(null);
      }
    }
    self = new PuzzleStream(file, format, iterator, db);
    return self;
  }

  /**
   * Lê até achar `count` puzzles que passam no filtro (e não estão em `exclude`).
   * Devolve menos se o arquivo acabar.
   */
  async take(count: number, filter: PuzzleFilter, exclude: Set<string>, signal?: AbortSignal, onScan?: (lines: number) => void): Promise<Puzzle[]> {
    const found: Puzzle[] = [];
    let sinceYield = 0;
    while (found.length < count && !this.done) {
      if (signal?.aborted) break;
      const step = await this.iterator.next();
      if (step.done) {
        this.done = true;
        break;
      }
      const puzzle = step.value;
      if (puzzle && !exclude.has(puzzle.id) && matchesFilter(puzzle, filter)) found.push(puzzle);
      sinceYield += 1;
      if (sinceYield >= 5000) {
        sinceYield = 0;
        onScan?.(this.linesRead);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    onScan?.(this.linesRead);
    return found;
  }

  close() {
    void this.iterator.return?.(undefined);
    this.db?.close();
    this.db = null;
    this.done = true;
  }
}

type Owner = () => PuzzleStream | null;

function textItems(file: File, format: FileFormat, skip: number, bump: (read: number, total: number) => void, owner: Owner) {
  return async function* (): AsyncGenerator<Item> {
    let header: string[] | null = null;
    let seen = 0;
    for await (const line of textLines(file, format, bump)) {
      const stream = owner();
      if (stream) stream.linesRead += 1;
      seen += 1;
      if (seen <= skip) {
        // Durante a retomada só precisamos achar o cabeçalho; o resto é descartado sem interpretar.
        if (!header && line.trim() && /puzzleid|fen/i.test(line)) header = splitCsv(line).map((cell) => cell.trim().toLowerCase());
        continue;
      }
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const cells = splitCsv(line);
      if (!header && cells.some((cell) => /^(puzzleid|fen|moves|rating|themes)$/i.test(cell.trim()))) {
        header = cells.map((cell) => cell.trim().toLowerCase());
        continue;
      }
      yield header ? puzzleFromHeader(header, cells, false) : puzzleFromLoose(cells);
    }
  };
}

function jsonItems(file: File, format: FileFormat, skip: number, owner: Owner) {
  return async function* (): AsyncGenerator<Item> {
    const decoder = new TextDecoder();
    const parts: string[] = [];
    for await (const chunk of decodedChunks(file, format)) parts.push(decoder.decode(chunk, { stream: true }));
    parts.push(decoder.decode());
    const { puzzles } = parsePuzzleDocument(parts.join(""));
    for (let i = skip; i < puzzles.length; i += 1) {
      const stream = owner();
      if (stream) {
        stream.linesRead = i + 1;
        stream.percent = ((i + 1) / puzzles.length) * 100;
      }
      yield puzzles[i];
    }
  };
}

function sqliteItems(db: Database, skip: number, owner: Owner) {
  return async function* (): AsyncGenerator<Item> {
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
    let index = 0;
    for (const rows of iterateRows(db, table.name, names, 500)) {
      for (const row of rows) {
        index += 1;
        const stream = owner();
        if (stream) {
          stream.linesRead = index;
          stream.percent = table.rows ? Math.min(100, (index / table.rows) * 100) : 0;
        }
        if (index <= skip) continue;
        yield normalizePuzzle(
          {
            id: cols.id ? String(row[cols.id] ?? "") : "",
            fen: String(row[cols.fen] ?? ""),
            moves: String(row[cols.moves] ?? ""),
            rating: cols.rating ? row[cols.rating] : 1200,
            themes: cols.themes ? String(row[cols.themes] ?? "") : "",
          },
          false,
        );
      }
    }
  };
}
