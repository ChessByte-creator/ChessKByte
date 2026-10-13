import type { GameFilters, GameRecord, GameResult } from "@/lib/games-db";
import type { Ply } from "@/lib/game";
import type { GameSource } from "@/lib/importers/game-source";
import { filterOpenings, kindOf, matchOpening, type Opening, type OpeningsIndex } from "@/lib/openings";
import { EcClient } from "./ec-client";
import type { EcFilter, EcInfo, EcRow } from "./ec-engine";

/** Cada consulta deve levar cerca de meio segundo: assim o progresso anda e o "Parar" responde rápido. */
const TARGET_MS = 450;
const MIN_RANGE = 4_000;
const MAX_RANGE = 600_000;

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Result do En Croissant: texto ("1-0") ou número (1 = brancas, 2 = pretas, 3 = empate). */
export function mapEcResult(raw: string | number | null): GameResult {
  if (typeof raw === "number") return raw === 1 ? "1-0" : raw === 2 ? "0-1" : raw === 3 ? "1/2-1/2" : "*";
  if (typeof raw === "string") {
    const text = raw.trim().replace("½-½", "1/2-1/2");
    if (text === "1-0" || text === "0-1" || text === "1/2-1/2") return text;
    if (text === "1") return "1-0";
    if (text === "2") return "0-1";
    if (text === "3") return "1/2-1/2";
  }
  return "*";
}

/** Abertura "base" de cada código ECO (a linha mais curta), já que o banco só guarda o ECO, não o nome. */
function ecoTable(openings: OpeningsIndex | null) {
  const table = new Map<string, Opening>();
  for (const entry of openings?.entries ?? []) {
    const current = table.get(entry.eco);
    if (!current || entry.san.length < current.san.length) table.set(entry.eco, entry);
  }
  return table;
}

export class EcSource implements GameSource {
  scanned = 0;
  done = false;
  percent = 0;
  readonly format = "db3";

  private cursor: number;
  private range = 20_000;
  private readonly baseEco: Map<string, Opening>;
  private cachedKey = "";
  private cachedFilter: EcFilter | null = null;

  private constructor(
    private readonly client: EcClient,
    private readonly info: EcInfo,
    private readonly openings: OpeningsIndex | null,
    private readonly fileName: string,
  ) {
    this.cursor = info.minId - 1;
    this.baseEco = ecoTable(openings);
  }

  /** Devolve null se o arquivo for SQLite mas não for um banco do En Croissant. */
  static async open(file: File, openings: OpeningsIndex | null): Promise<{ source: EcSource; warning?: string } | null> {
    const client = new EcClient();
    try {
      const opened = await client.open(file);
      if (!("info" in opened)) {
        client.close();
        return null;
      }
      const source = new EcSource(client, opened.info, openings, file.name);
      return { source, warning: await source.checkOrder() };
    } catch (error) {
      client.close();
      throw new Error(error instanceof Error && error.message ? `Não consegui abrir o banco: ${error.message}` : "Não consegui abrir o banco.");
    }
  }

  /**
   * Confere se a decodificação dos lances bate com o arquivo: decodifica os primeiros lances de algumas
   * partidas e compara a abertura reconhecida com o ECO gravado. Se a ordem estiver errada, quase nada bate.
   */
  private async checkOrder(): Promise<string | undefined> {
    if (!this.openings) return undefined;
    const rows = await this.client.page({}, this.info.minId - 1, this.info.minId + 4000, 40);
    let checked = 0;
    let agree = 0;
    for (const row of rows) {
      if (checked >= 12) break;
      if (!/^[A-E]\d\d$/i.test(row.eco) || row.plies < 12) continue;
      const game = await this.client.game(row.id, 14);
      if (!game) continue;
      checked += 1;
      const match = matchOpening(this.openings, game.plies.map((ply) => ply.fen));
      if (match.opening && match.opening.eco[0] === row.eco[0].toUpperCase()) agree += 1;
    }
    if (checked >= 6 && agree / checked < 0.5) {
      return "Não consegui confirmar que os lances deste banco estão sendo decodificados na ordem certa (a abertura das partidas não bate com o ECO gravado). As partidas podem abrir erradas.";
    }
    return undefined;
  }

  restart() {
    this.cursor = this.info.minId - 1;
    this.scanned = 0;
    this.percent = 0;
    this.done = false;
  }

  /** Há índice de jogador no arquivo? Então a busca por jogador não precisa varrer o banco. */
  get playerIndexed() {
    return this.info.indexed.includes("whiteid") && this.info.indexed.includes("blackid");
  }

  close() {
    this.client.close();
    this.done = true;
  }

  async loadPlies(game: GameRecord): Promise<Ply[] | null> {
    if (game.ecId == null) return null;
    const decoded = await this.client.game(game.ecId);
    if (!decoded) return null;
    return decoded.plies;
  }

  private async translate(filters: GameFilters): Promise<EcFilter> {
    const key = JSON.stringify(filters);
    if (this.cachedFilter && key === this.cachedKey) return this.cachedFilter;
    const out: EcFilter = {};
    if (filters.player) out.playerIds = await this.client.ids("players", filters.player);
    if (filters.text) {
      const text = filters.text.trim();
      if (/^[a-e]\d{0,2}$/i.test(text)) {
        out.ecoPrefix = text;
      } else {
        const codes = new Set<string>();
        if (this.openings) for (const entry of filterOpenings(this.openings, { query: text, kind: "all" })) codes.add(entry.eco);
        out.textEco = [...codes].slice(0, 800);
        out.textEvents = await this.client.ids("events", text);
      }
    }
    if (filters.eco && !out.ecoPrefix) out.ecoPrefix = filters.eco;
    if (filters.kind && filters.kind !== "all" && this.openings) {
      const codes = new Set<string>();
      for (const entry of this.openings.entries) {
        const hit = filters.kind === "gambit" ? entry.kind === "gambit" || entry.hasGambit : entry.kind === filters.kind;
        if (hit) codes.add(entry.eco);
      }
      out.kindEco = [...codes];
    }
    if (filters.result && filters.result !== "all") out.resultRaw = this.info.resultSample.filter((raw) => mapEcResult(raw) === filters.result);
    if (filters.minElo) out.minElo = filters.minElo;
    if (filters.yearFrom) out.yearFrom = filters.yearFrom;
    if (filters.yearTo) out.yearTo = filters.yearTo;
    this.cachedKey = key;
    this.cachedFilter = out;
    return out;
  }

  private toRecord(row: EcRow): GameRecord {
    const base = this.baseEco.get(row.eco.toUpperCase()) ?? null;
    const name = base?.name ?? "";
    const { kind, hasGambit } = kindOf(name);
    const cat: string[] = [kind];
    if (hasGambit && kind !== "gambit") cat.push("gambit");
    return {
      id: row.id,
      ecId: row.id,
      white: row.white,
      black: row.black,
      whiteElo: row.whiteElo,
      blackElo: row.blackElo,
      maxElo: Math.max(row.whiteElo, row.blackElo),
      result: mapEcResult(row.result),
      year: Number(row.date.slice(0, 4)) || 0,
      event: row.event,
      site: row.site,
      timeControl: row.timeControl,
      termination: "",
      eco: row.eco,
      opening: name,
      family: name.split(":")[0]?.trim() ?? "",
      kind,
      cat,
      players: [norm(row.white), norm(row.black)],
      plies: row.plies,
      moves: "",
      source: this.fileName,
    };
  }

  async take(
    count: number,
    filters: GameFilters,
    signal?: AbortSignal,
    onScan?: (scanned: number, percent: number) => void,
    onFound?: (rows: GameRecord[]) => void,
  ): Promise<GameRecord[]> {
    const filter = await this.translate(filters);
    const found: GameRecord[] = [];
    const span = Math.max(1, this.info.maxId - this.info.minId + 1);
    const progress = () => {
      this.scanned = Math.max(0, this.cursor - this.info.minId + 1);
      this.percent = Math.min(100, (this.scanned / span) * 100);
      onScan?.(this.scanned, this.percent);
    };

    // Caminho rápido: jogador com índice no arquivo. Uma consulta devolve a página inteira.
    if (this.client && filter.playerIds && this.playerIndexed && filter.playerIds.length > 0 && filter.playerIds.length <= 12) {
      if (!this.done && !signal?.aborted) {
        const rows = await this.client.pageByPlayerIndex(filter, this.cursor, count);
        const records = rows.map((row) => this.toRecord(row));
        found.push(...records);
        if (records.length > 0) onFound?.(records);
        if (rows.length < count) {
          this.cursor = this.info.maxId;
          this.done = true;
        } else {
          this.cursor = rows[rows.length - 1].id;
        }
        progress();
      }
      return found;
    }

    while (found.length < count && !this.done) {
      if (signal?.aborted) break;
      const need = count - found.length;
      const upper = Math.min(this.cursor + this.range, this.info.maxId);
      const started = Date.now();
      const rows = await this.client.page(filter, this.cursor, upper, need);
      const elapsed = Date.now() - started;
      // Ajusta o tamanho da próxima faixa para cada consulta durar ~meio segundo.
      this.range = Math.round(Math.min(MAX_RANGE, Math.max(MIN_RANGE, (this.range * TARGET_MS) / Math.max(elapsed, 25))));
      const records = rows.map((row) => this.toRecord(row));
      found.push(...records);
      if (records.length > 0) onFound?.(records);
      if (rows.length >= need) {
        this.cursor = rows[rows.length - 1].id;
      } else {
        this.cursor = upper;
        if (upper >= this.info.maxId) this.done = true;
      }
      progress();
    }
    return found;
  }
}
