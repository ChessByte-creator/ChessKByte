import { Chess } from "chess.js";
import { kindOf, matchOpening, type OpeningsIndex } from "@/lib/openings";
import type { GameRecord, GameResult } from "@/lib/games-db";

export type PgnGame = { headers: Record<string, string>; movetext: string };

const TAG = /^\[(\w+)\s+"(.*)"\]\s*$/;

/** Separa partidas de um fluxo de linhas de PGN, uma de cada vez (sem carregar o arquivo inteiro). */
export function* splitPgn(lines: Iterable<string>): Generator<PgnGame> {
  let headers: Record<string, string> = {};
  let moves: string[] = [];
  let inMoves = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (inMoves) {
        yield { headers, movetext: moves.join(" ") };
        headers = {};
        moves = [];
        inMoves = false;
      }
      const match = TAG.exec(line);
      if (match) headers[match[1]] = match[2];
      continue;
    }
    if (!line) continue;
    inMoves = true;
    moves.push(line);
  }
  if (inMoves || Object.keys(headers).length > 0) yield { headers, movetext: moves.join(" ") };
}

/** Versão assíncrona, para fluxos que vêm de arquivos grandes. */
export async function* splitPgnAsync(lines: AsyncIterable<string>): AsyncGenerator<PgnGame> {
  let headers: Record<string, string> = {};
  let moves: string[] = [];
  let inMoves = false;
  for await (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (inMoves) {
        yield { headers, movetext: moves.join(" ") };
        headers = {};
        moves = [];
        inMoves = false;
      }
      const match = TAG.exec(line);
      if (match) headers[match[1]] = match[2];
      continue;
    }
    if (!line) continue;
    inMoves = true;
    moves.push(line);
  }
  if (inMoves || Object.keys(headers).length > 0) yield { headers, movetext: moves.join(" ") };
}

/** Tira comentários, variantes, NAGs, números de lance e resultado; devolve só os lances em SAN. */
export function cleanMovetext(text: string): string[] {
  let out = text.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  // variantes aninhadas: remove de dentro para fora
  for (let i = 0; i < 6 && out.includes("("); i += 1) out = out.replace(/\([^()]*\)/g, " ");
  out = out.replace(/\$\d+/g, " ").replace(/\d+\.(\.\.)?/g, " ");
  return out
    .split(/\s+/)
    .map((token) => token.replace(/[!?]+$/, ""))
    .filter((token) => token && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token));
}

function num(value: string | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function asResult(value: string | undefined): GameResult {
  return value === "1-0" || value === "0-1" || value === "1/2-1/2" ? value : "*";
}

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type BuildOptions = { openings: OpeningsIndex | null; source: string };

/** Transforma uma partida de PGN em registro do repositório. Devolve null se não houver lances. */
export function buildGame(game: PgnGame, options: BuildOptions): GameRecord | null {
  const h = game.headers;
  const tokens = cleanMovetext(game.movetext);
  if (tokens.length === 0) return null;

  const whiteElo = num(h.WhiteElo);
  const blackElo = num(h.BlackElo);
  let name = (h.Opening ?? "").trim();
  let eco = (h.ECO ?? "").trim();
  if (name === "?" || name === "") name = "";
  if (eco === "?") eco = "";

  // Sem nome de abertura no PGN, reconhece pelas posições da nossa base.
  if (!name && options.openings) {
    const chess = new Chess();
    const fens = [chess.fen()];
    for (const san of tokens.slice(0, 24)) {
      try {
        chess.move(san);
      } catch {
        break;
      }
      fens.push(chess.fen());
    }
    const match = matchOpening(options.openings, fens);
    if (match.opening) {
      name = match.opening.name;
      eco = eco || match.opening.eco;
    }
  }

  const family = name.split(":")[0]?.trim() ?? "";
  const { kind, hasGambit } = kindOf(name);
  const dateText = h.UTCDate ?? h.Date ?? "";
  const year = num(dateText.slice(0, 4));
  const white = h.White ?? "?";
  const black = h.Black ?? "?";
  const cat: string[] = [kind];
  if (hasGambit && kind !== "gambit") cat.push("gambit");

  return {
    white,
    black,
    whiteElo,
    blackElo,
    maxElo: Math.max(whiteElo, blackElo),
    result: asResult(h.Result),
    year,
    event: h.Event ?? "",
    site: h.Site ?? "",
    timeControl: h.TimeControl ?? "",
    termination: h.Termination ?? "",
    eco,
    opening: name,
    family,
    kind,
    cat,
    players: [norm(white), norm(black)],
    plies: tokens.length,
    moves: tokens.join(" "),
    source: options.source,
  };
}
