import type { Ply } from "@/lib/game";
import { cachedReader, FileVFS, type SyncReader } from "./file-vfs";
import { decodeEcMoves } from "./move-order";

/**
 * Motor de leitura dos bancos do En Croissant (.db3 = SQLite com Games, Players, Events, Sites, Info).
 * Roda dentro de um Worker. Nada é importado: o SQLite lê só as páginas que cada consulta toca.
 * Os nomes das colunas são descobertos com PRAGMA table_info (sem diferenciar maiúsculas), então pequenas
 * diferenças de versão do En Croissant não quebram a leitura.
 */

const SQLITE_ROW = 100;
const OPEN_READONLY = 0x1;

type Sqlite3Api = {
  vfs_register(vfs: unknown, makeDefault?: boolean): number;
  open_v2(name: string, flags?: number, vfs?: string): Promise<number>;
  close(db: number): Promise<number>;
  statements(db: number, sql: string): AsyncIterable<number>;
  bind_collection(stmt: number, bindings: unknown[]): number;
  step(stmt: number): Promise<number>;
  row(stmt: number): unknown[];
};

export type EcRow = {
  id: number;
  date: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  /** Valor bruto da coluna Result (texto ou número, conforme a versão do En Croissant). */
  result: string | number | null;
  eco: string;
  plies: number;
  event: string;
  site: string;
  timeControl: string;
};

export type PlayerHit = { id: number; name: string; elo: number };

export type EcFilter = {
  /** IDs da tabela Players (já resolvidos pelo nome). Lista vazia = nenhuma partida. */
  playerIds?: number[];
  /** Só partidas em que o jogador teve esta cor. */
  side?: "white" | "black";
  /** Adversário (IDs de Players): confronto direto com o jogador. */
  opponentIds?: number[];
  /** Resultado do ponto de vista do jogador: valores brutos de Result que contam, para cada cor dele. */
  outcome?: { white: Array<string | number>; black: Array<string | number> };
  /** Restrição por lista de códigos ECO (aberturas escolhidas). */
  ecoIn?: string[];
  /** Texto livre: partidas cujo ECO está em textEco OU cujo evento está em textEvents. */
  textEco?: string[];
  textEvents?: number[];
  /** Restrição extra por ECO (tipo de abertura: defesas, gambitos...). */
  kindEco?: string[];
  ecoPrefix?: string;
  resultRaw?: Array<string | number>;
  minElo?: number;
  yearFrom?: number;
  yearTo?: number;
};

export type EcInfo = {
  minId: number;
  maxId: number;
  /** Total declarado na tabela Info (GameCount), se existir. */
  declaredGames: number | null;
  title: string;
  /** Valores distintos de Result vistos nas primeiras linhas (para montar o filtro de resultado). */
  resultSample: Array<string | number>;
  tables: string[];
  /** Primeira coluna de cada índice da tabela Games, em minúsculas (ex.: "whiteid"). O En Croissant cria esses índices pelo menu do banco. */
  indexed: string[];
};

export type NotEc = { ec: false; tables: string[] };

type Columns = Record<string, string | null>;

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(columns: string[], aliases: string[]): string | null {
  const map = new Map(columns.map((name) => [norm(name), name]));
  for (const alias of aliases) {
    const hit = map.get(norm(alias));
    if (hit) return hit;
  }
  return null;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

function ints(values: number[] | undefined) {
  return (values ?? []).filter((value) => Number.isInteger(value)).join(",");
}

function ecos(values: string[] | undefined) {
  return (values ?? [])
    .filter((value) => /^[A-E][0-9]{2}$/i.test(value))
    .map((value) => `'${value.toUpperCase()}'`)
    .join(",");
}

/** Dá para achar as partidas do jogador pelos índices de WhiteID/BlackID (sem varrer a tabela)? */
export function canUsePlayerIndex(filter: EcFilter, indexed: string[]) {
  const ids = filter.playerIds;
  if (!ids || ids.length === 0 || ids.length > 12) return false;
  const needWhite = filter.side !== "black";
  const needBlack = filter.side !== "white";
  return (!needWhite || indexed.includes("whiteid")) && (!needBlack || indexed.includes("blackid"));
}

function lit(value: string | number) {
  return typeof value === "number" ? String(Number.isFinite(value) ? value : 0) : `'${value.replace(/'/g, "''")}'`;
}

export class EcDatabase {
  private constructor(
    private readonly sqlite3: Sqlite3Api,
    private db: number,
    readonly info: EcInfo,
    private readonly g: Columns,
    private readonly names: Record<"players" | "events" | "sites", { table: string; id: string; name: string; elo?: string | null } | null>,
    private readonly gamesTable: string,
  ) {}

  /** Abre o arquivo. Devolve `{ ec: false }` se não for um banco do En Croissant. */
  static async open(sqlite3: Sqlite3Api, reader: SyncReader, fileName: string): Promise<EcDatabase | NotEc> {
    const vfs = new FileVFS(new Map([[fileName, cachedReader(reader)]]));
    sqlite3.vfs_register(vfs, false);
    const db = await sqlite3.open_v2(fileName, OPEN_READONLY, vfs.name);
    const select = (sql: string, params: unknown[] = []) => run(sqlite3, db, sql, params);

    const tables = (await select("SELECT name FROM sqlite_master WHERE type='table'")).map((row) => String(row[0]));
    const tableByNorm = new Map(tables.map((name) => [norm(name), name]));
    const gamesTable = tableByNorm.get("games");
    if (!gamesTable) {
      await sqlite3.close(db);
      return { ec: false, tables };
    }
    const columnsOf = async (table: string) => (await select(`PRAGMA table_info(${q(table)})`)).map((row) => String(row[1]));
    const gc = await columnsOf(gamesTable);
    const g: Columns = {
      id: pick(gc, ["id"]),
      eventId: pick(gc, ["eventid", "event_id"]),
      siteId: pick(gc, ["siteid", "site_id"]),
      date: pick(gc, ["date", "utcdate"]),
      whiteId: pick(gc, ["whiteid", "white_id"]),
      whiteElo: pick(gc, ["whiteelo", "white_elo"]),
      blackId: pick(gc, ["blackid", "black_id"]),
      blackElo: pick(gc, ["blackelo", "black_elo"]),
      result: pick(gc, ["result"]),
      timeControl: pick(gc, ["timecontrol", "time_control"]),
      eco: pick(gc, ["eco"]),
      plyCount: pick(gc, ["plycount", "ply_count"]),
      fen: pick(gc, ["fen"]),
      moves: pick(gc, ["moves"]),
    };
    if (!g.id || !g.whiteId || !g.blackId || !g.moves) {
      await sqlite3.close(db);
      return { ec: false, tables };
    }

    const nameTable = async (key: string) => {
      const table = tableByNorm.get(key);
      if (!table) return null;
      const cols = await columnsOf(table);
      const id = pick(cols, ["id"]);
      const name = pick(cols, ["name"]);
      return id && name ? { table, id, name, elo: pick(cols, ["elo"]) } : null;
    };
    const names = { players: await nameTable("players"), events: await nameTable("events"), sites: await nameTable("sites") };

    const idCol = q(g.id);
    // MIN e MAX em consultas separadas: juntos, o SQLite varre a tabela inteira; separados, só olha as pontas.
    const minId = Number((await select(`SELECT MIN(${idCol}) FROM ${q(gamesTable)}`))[0]?.[0] ?? 0);
    const maxId = Number((await select(`SELECT MAX(${idCol}) FROM ${q(gamesTable)}`))[0]?.[0] ?? 0);

    const infoTable = tableByNorm.get("info");
    let declaredGames: number | null = null;
    let title = "";
    if (infoTable) {
      const cols = await columnsOf(infoTable);
      const nameCol = pick(cols, ["name"]);
      const valueCol = pick(cols, ["value"]);
      if (nameCol && valueCol) {
        for (const row of await select(`SELECT ${q(nameCol)}, ${q(valueCol)} FROM ${q(infoTable)}`)) {
          const key = norm(String(row[0]));
          if (key === "gamecount") declaredGames = Number(row[1]) || null;
          if (key === "title") title = String(row[1] ?? "");
        }
      }
    }

    let resultSample: Array<string | number> = [];
    if (g.result) {
      const seen = new Set<string | number>();
      for (const row of await select(`SELECT ${q(g.result)} FROM ${q(gamesTable)} LIMIT 3000`)) {
        const value = row[0];
        if (typeof value === "string" || typeof value === "number") seen.add(value);
      }
      resultSample = [...seen];
    }

    const indexed: string[] = [];
    try {
      for (const index of await select(`PRAGMA index_list(${q(gamesTable)})`)) {
        const first = (await select(`PRAGMA index_info(${q(String(index[1]))})`))[0];
        if (first) indexed.push(norm(String(first[2])));
      }
    } catch {
      /* sem a informação, a busca só varre por ID */
    }

    const info: EcInfo = { minId, maxId, declaredGames, title, resultSample, tables, indexed };
    return new EcDatabase(sqlite3, db, info, g, names, gamesTable);
  }

  private select(sql: string, params: unknown[] = []) {
    return run(this.sqlite3, this.db, sql, params);
  }

  /**
   * Jogadores pelo nome, já ordenados (nome igual primeiro, depois começo do nome, depois os mais curtos).
   * Começo do nome usa o índice UNIQUE de Name (instantâneo mesmo com milhões de jogadores) e como o índice
   * diferencia maiúsculas, tenta como digitado, Capitalizado, minúsculo e MAIÚSCULO. Se nada começa assim,
   * procura a parte do nome em qualquer lugar (percorre a tabela de nomes, mais lento).
   */
  async suggestPlayers(text: string, limit = 8): Promise<PlayerHit[]> {
    const t = this.names.players;
    const clean = text.trim().replace(/[%_]/g, "");
    if (!t || !clean) return [];
    const eloCol = t.elo ? `, ${q(t.elo)}` : ", NULL";
    const hits = new Map<number, PlayerHit>();
    const take = (rows: unknown[][]) => {
      for (const row of rows) hits.set(Number(row[0]), { id: Number(row[0]), name: String(row[1] ?? ""), elo: Number(row[2]) || 0 });
    };
    const variants = [...new Set([clean, clean[0].toUpperCase() + clean.slice(1), clean.toLowerCase(), clean.toUpperCase()])];
    for (const variant of variants) {
      take(await this.select(`SELECT ${q(t.id)}, ${q(t.name)}${eloCol} FROM ${q(t.table)} WHERE ${q(t.name)} >= ? AND ${q(t.name)} < ? ORDER BY ${q(t.name)} LIMIT ${limit}`, [variant, `${variant}\uffff`]));
    }
    if (hits.size === 0) take(await this.select(`SELECT ${q(t.id)}, ${q(t.name)}${eloCol} FROM ${q(t.table)} WHERE ${q(t.name)} LIKE ? LIMIT ${limit}`, [`%${clean}%`]));
    const lower = clean.toLowerCase();
    return [...hits.values()]
      .sort((a, b) => Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower) || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /** IDs de jogadores/eventos pelo nome (para os filtros por texto). */
  async ids(kind: "players" | "events", text: string, limit = 3000): Promise<number[]> {
    if (kind === "players") return (await this.suggestPlayers(text, 200)).map((hit) => hit.id);
    const t = this.names.events;
    const clean = text.trim().replace(/[%_]/g, "");
    if (!t || !clean) return [];
    const rows = await this.select(`SELECT ${q(t.id)} FROM ${q(t.table)} WHERE ${q(t.name)} LIKE ? LIMIT ${limit}`, [`%${clean}%`]);
    return rows.map((row) => Number(row[0]));
  }

  /** Quantas partidas o jogador tem (só quando há índice: contar sem índice varreria o arquivo inteiro). */
  async countPlayerGames(ids: number[], side?: "white" | "black"): Promise<number | null> {
    const g = this.g;
    const list = ints(ids);
    if (!list) return 0;
    const sides = side ? [side] : (["white", "black"] as const);
    let total = 0;
    for (const item of sides) {
      const col = item === "white" ? g.whiteId : g.blackId;
      if (!col || !this.info.indexed.includes(norm(col))) return null;
      const rows = await this.select(`SELECT COUNT(*) FROM ${q(this.gamesTable)} WHERE ${q(col)} IN (${list})`);
      total += Number(rows[0]?.[0] ?? 0);
    }
    return total;
  }

  /**
   * Partidas dos jogadores usando os índices de WhiteID/BlackID: cada (lado, jogador) é uma consulta que já sai
   * em ordem de ID e para no limite; depois é só juntar. O custo é proporcional à página, não ao tamanho do arquivo.
   */
  async pageByPlayerIndex(filter: EcFilter, afterId: number, limit: number): Promise<EcRow[]> {
    const g = this.g;
    const ids = (filter.playerIds ?? []).filter((value) => Number.isInteger(value));
    const rest: EcFilter = { ...filter, playerIds: undefined };
    const lists: EcRow[][] = [];
    for (const id of ids) {
      for (const side of ["white", "black"] as const) {
        if (filter.side && filter.side !== side) continue;
        const column = (side === "white" ? g.whiteId : g.blackId) as string;
        lists.push(await this.page(rest, afterId, this.info.maxId, limit, { column, id }));
      }
    }
    const merged = new Map<number, EcRow>();
    for (const list of lists) for (const row of list) merged.set(row.id, row);
    return [...merged.values()].sort((a, b) => a.id - b.id).slice(0, limit);
  }

  /** Partidas com ID em (afterId, untilId] que passam nos filtros, em ordem de ID, no máximo `limit`. */
  async page(filter: EcFilter, afterId: number, untilId: number, limit: number, only?: { column: string; id: number }): Promise<EcRow[]> {
    const g = this.g;
    const where: string[] = [`g.${q(g.id as string)} > ?`, `g.${q(g.id as string)} <= ?`];
    const params: unknown[] = [afterId, untilId];
    // Condições do jogador, lado a lado: (jogador de brancas E adversário de pretas E resultado dele) OU (o inverso).
    const branch = (side: "white" | "black", playerCond: string | null): string | null => {
      const own = side === "white" ? g.whiteId : g.blackId;
      const other = side === "white" ? g.blackId : g.whiteId;
      const parts: string[] = [];
      if (playerCond) parts.push(playerCond);
      if (filter.opponentIds && other) {
        const list = ints(filter.opponentIds);
        if (!list) return null;
        parts.push(`g.${q(other)} IN (${list})`);
      }
      if (filter.outcome && g.result) {
        const raw = filter.outcome[side];
        if (raw.length === 0) return null;
        parts.push(`g.${q(g.result)} IN (${raw.map(lit).join(",")})`);
      }
      void own;
      return parts.length > 0 ? `(${parts.join(" AND ")})` : "1";
    };
    if (only) {
      const side = only.column === g.whiteId ? "white" : "black";
      const cond = branch(side, `g.${q(only.column)} = ${Math.trunc(only.id)}`);
      if (!cond) return [];
      where.push(cond);
    }

    if (filter.playerIds) {
      const list = ints(filter.playerIds);
      if (!list) return [];
      const branches: string[] = [];
      if (filter.side !== "black") {
        const cond = branch("white", `g.${q(g.whiteId as string)} IN (${list})`);
        if (cond) branches.push(cond);
      }
      if (filter.side !== "white") {
        const cond = branch("black", `g.${q(g.blackId as string)} IN (${list})`);
        if (cond) branches.push(cond);
      }
      if (branches.length === 0) return [];
      where.push(`(${branches.join(" OR ")})`);
    }
    if (filter.ecoIn) {
      const eco = ecos(filter.ecoIn);
      if (!eco || !g.eco) return [];
      where.push(`g.${q(g.eco)} IN (${eco})`);
    }
    if (filter.textEco || filter.textEvents) {
      const parts: string[] = [];
      const eco = ecos(filter.textEco);
      const ev = ints(filter.textEvents);
      if (eco && g.eco) parts.push(`g.${q(g.eco)} IN (${eco})`);
      if (ev && g.eventId) parts.push(`g.${q(g.eventId)} IN (${ev})`);
      if (parts.length === 0) return [];
      where.push(`(${parts.join(" OR ")})`);
    }
    if (filter.kindEco) {
      const eco = ecos(filter.kindEco);
      if (!eco || !g.eco) return [];
      where.push(`g.${q(g.eco)} IN (${eco})`);
    }
    if (filter.ecoPrefix && g.eco) {
      where.push(`g.${q(g.eco)} LIKE ?`);
      params.push(`${filter.ecoPrefix.replace(/[%_]/g, "").toUpperCase()}%`);
    }
    if (filter.resultRaw && g.result) {
      if (filter.resultRaw.length === 0) return [];
      where.push(`g.${q(g.result)} IN (${filter.resultRaw.map(() => "?").join(",")})`);
      params.push(...filter.resultRaw);
    }
    if (filter.minElo && g.whiteElo && g.blackElo) {
      where.push(`(g.${q(g.whiteElo)} >= ? OR g.${q(g.blackElo)} >= ?)`);
      params.push(filter.minElo, filter.minElo);
    }
    if (g.date) {
      if (filter.yearFrom) {
        where.push(`g.${q(g.date)} >= ?`);
        params.push(String(filter.yearFrom));
      }
      if (filter.yearTo) {
        where.push(`g.${q(g.date)} < ?`);
        params.push(String(filter.yearTo + 1));
      }
    }

    const col = (name: string | null, alias: string) => (name ? `g.${q(name)} AS ${alias}` : `NULL AS ${alias}`);
    const join = (key: "players" | "events" | "sites", alias: string, on: string | null, label: string) => {
      const t = this.names[key];
      if (!t || !on) return { select: `'' AS ${label}`, join: "" };
      return { select: `${alias}.${q(t.name)} AS ${label}`, join: `LEFT JOIN ${q(t.table)} ${alias} ON ${alias}.${q(t.id)} = g.${q(on)}` };
    };
    const w = join("players", "pw", g.whiteId, "white_name");
    const b = join("players", "pb", g.blackId, "black_name");
    const e = join("events", "ev", g.eventId, "event_name");
    const s = join("sites", "st", g.siteId, "site_name");

    const sql = `SELECT g.${q(g.id as string)} AS id, ${col(g.date, "date")}, ${w.select}, ${b.select}, ${col(g.whiteElo, "white_elo")}, ${col(g.blackElo, "black_elo")}, ${col(g.result, "result")}, ${col(g.eco, "eco")}, ${col(g.plyCount, "plies")}, ${e.select}, ${s.select}, ${col(g.timeControl, "time_control")}
      FROM ${q(this.gamesTable)} g ${w.join} ${b.join} ${e.join} ${s.join}
      WHERE ${where.join(" AND ")}
      ORDER BY g.${q(g.id as string)} LIMIT ${Math.max(1, Math.floor(limit))}`;

    const rows = await this.select(sql, params);
    return rows.map((row) => ({
      id: Number(row[0]),
      date: String(row[1] ?? ""),
      white: String(row[2] ?? "?"),
      black: String(row[3] ?? "?"),
      whiteElo: Number(row[4]) || 0,
      blackElo: Number(row[5]) || 0,
      result: typeof row[6] === "string" || typeof row[6] === "number" ? row[6] : null,
      eco: String(row[7] ?? ""),
      plies: Number(row[8]) || 0,
      event: String(row[9] ?? ""),
      site: String(row[10] ?? ""),
      timeControl: String(row[11] ?? ""),
    }));
  }

  /** Lê os bytes de lances de uma partida e decodifica (só quando o jogador abre a partida). */
  async loadGame(id: number, maxPlies?: number): Promise<{ plies: Ply[]; san: string; ok: boolean } | null> {
    const g = this.g;
    const rows = await this.select(`SELECT ${q(g.moves as string)}, ${g.fen ? q(g.fen) : "NULL"} FROM ${q(this.gamesTable)} WHERE ${q(g.id as string)} = ?`, [id]);
    const row = rows[0];
    if (!row) return null;
    const blob = row[0] instanceof Uint8Array ? row[0] : new Uint8Array(0);
    return decodeEcMoves(maxPlies ? blob.subarray(0, maxPlies) : blob, typeof row[1] === "string" && row[1] ? row[1] : null);
  }

  async close() {
    if (this.db) await this.sqlite3.close(this.db);
    this.db = 0;
  }
}

async function run(sqlite3: Sqlite3Api, db: number, sql: string, params: unknown[]): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  for await (const stmt of sqlite3.statements(db, sql)) {
    if (params.length > 0) sqlite3.bind_collection(stmt, params);
    while ((await sqlite3.step(stmt)) === SQLITE_ROW) rows.push(sqlite3.row(stmt));
  }
  return rows;
}
