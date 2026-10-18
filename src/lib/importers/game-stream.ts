import type { Database } from "sql.js";
import { gameMatcher, type GameFilters, type GameRecord } from "@/lib/games-db";
import { buildGame, splitPgn, splitPgnAsync, type PgnGame } from "@/lib/importers/pgn";
import { sniffFormat, textLines, type FileFormat } from "@/lib/importers/sources";
import { iterateRows, listTables, openSqlite, pickColumn } from "@/lib/importers/sqlite";
import type { OpeningsIndex } from "@/lib/openings";

type Item = GameRecord | null;

/**
 * Repositório sob demanda: o arquivo (PGN, .pgn.zst, .pgn.gz ou .db) não é importado. Cada `take`
 * lê só até achar as partidas pedidas dentro dos filtros e continua dali na vez seguinte.
 * `restart` volta ao começo do arquivo (nova busca).
 */
export class GameStream {
  /** Partidas lidas do arquivo até agora (com ou sem filtro). */
  scanned = 0;
  done = false;
  percent = 0;
  readonly format: FileFormat;

  private iterator: AsyncIterator<Item>;
  /** Faixa de rating do jogador mais forte pedida na busca: descarta pelo cabeçalho, antes de processar a partida. */
  eloRange: { min: number; max: number } | null = null;

  private constructor(
    readonly file: File,
    format: FileFormat,
    private readonly make: (stream: GameStream) => AsyncIterator<Item>,
    private db: Database | null,
  ) {
    this.format = format;
    this.iterator = make(this);
  }

  static async open(file: File, openings: OpeningsIndex | null): Promise<GameStream> {
    const format = await sniffFormat(file);
    if (format === "zip" || format === "bzip2") throw new Error(format === "zip" ? "Extraia o .zip antes." : "Arquivos .bz2 não são suportados. Use .pgn.zst ou .pgn.gz.");
    if (format === "sqlite") {
      const db = await openSqlite(file);
      return new GameStream(file, format, (stream) => sqliteGames(db, openings, file.name, stream)(), db);
    }
    return new GameStream(file, format, (stream) => pgnGames(file, format, openings, stream)(), null);
  }

  /** Recomeça do início do arquivo (usado quando os filtros mudam). */
  restart() {
    void this.iterator.return?.(undefined);
    this.scanned = 0;
    this.percent = 0;
    this.done = false;
    this.iterator = this.make(this);
  }

  async take(count: number, filters: GameFilters, signal?: AbortSignal, onScan?: (scanned: number, percent: number) => void, onFound?: (rows: GameRecord[]) => void): Promise<GameRecord[]> {
    const match = gameMatcher(filters);
    this.eloRange = filters.minElo || filters.maxElo ? { min: filters.minElo ?? 0, max: filters.maxElo ?? 0 } : null;
    const found: GameRecord[] = [];
    let sinceYield = 0;
    let lastReport = Date.now();
    onScan?.(this.scanned, this.percent);
    while (found.length < count && !this.done) {
      if (signal?.aborted) break;
      const step = await this.iterator.next();
      if (step.done) {
        this.done = true;
        break;
      }
      const game = step.value;
      if (game && match(game)) {
        found.push(game);
        onFound?.([game]);
      }
      sinceYield += 1;
      // Avisa o progresso e cede o fluxo à interface a cada ~0,3 s (num filtro raro, 2000 partidas podiam levar minutos no celular).
      if (sinceYield >= 200 && Date.now() - lastReport >= 300) {
        sinceYield = 0;
        lastReport = Date.now();
        onScan?.(this.scanned, this.percent);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    onScan?.(this.scanned, this.percent);
    return found;
  }

  close() {
    void this.iterator.return?.(undefined);
    this.db?.close();
    this.db = null;
    this.done = true;
  }
}

function pgnGames(file: File, format: FileFormat, openings: OpeningsIndex | null, stream: GameStream) {
  return async function* (): AsyncGenerator<Item> {
    const lines = textLines(file, format, (read, total) => {
      if (total > 0) stream.percent = Math.min(100, (read / total) * 100);
    });
    for await (const game of splitPgnAsync(lines)) {
      stream.scanned += 1;
      const range = stream.eloRange;
      if (range) {
        // Rating pelo cabeçalho: evita processar os lances e a abertura de uma partida que o filtro vai descartar.
        const strongest = Math.max(Number(game.headers.WhiteElo) || 0, Number(game.headers.BlackElo) || 0);
        if ((range.min && strongest < range.min) || (range.max && (!strongest || strongest > range.max))) {
          yield null;
          continue;
        }
      }
      yield buildGame(game, { openings, source: file.name });
    }
  };
}

function sqliteGames(db: Database, openings: OpeningsIndex | null, source: string, stream: GameStream) {
  return async function* (): AsyncGenerator<Item> {
    const tables = listTables(db);
    const table =
      tables.find((item) => pickColumn(item.columns, ["pgn"])) ??
      tables.find((item) => pickColumn(item.columns, ["moves", "movetext"]) && pickColumn(item.columns, ["white"]));
    if (!table) throw new Error("Não achei uma tabela de partidas (coluna pgn, ou white + moves).");
    const pgnCol = pickColumn(table.columns, ["pgn"]);
    const movesCol = pickColumn(table.columns, ["moves", "movetext"]);
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
    const names = [...new Set([pgnCol, movesCol, ...Object.values(fields)].filter((name): name is string => Boolean(name)))];
    let rowsSeen = 0;
    for (const rows of iterateRows(db, table.name, names, 500)) {
      for (const row of rows) {
        rowsSeen += 1;
        stream.percent = table.rows ? Math.min(100, (rowsSeen / table.rows) * 100) : 0;
        const games: PgnGame[] = [];
        if (pgnCol && row[pgnCol]) {
          games.push(...splitPgn(String(row[pgnCol]).split(/\r?\n/)));
        } else if (movesCol) {
          const headers: Record<string, string> = {};
          for (const [tag, column] of Object.entries(fields)) if (column && row[column] != null) headers[tag] = String(row[column]);
          games.push({ headers, movetext: String(row[movesCol] ?? "") });
        }
        for (const game of games) {
          stream.scanned += 1;
          yield buildGame(game, { openings, source });
        }
      }
    }
  };
}
