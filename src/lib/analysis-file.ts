import { Chess } from "chess.js";
import { JUDGMENT_META, JUDGMENT_ORDER, type Judgment, type WhiteEval } from "@/lib/eval";
import { START_FEN, appendMove, isStandardStart, pliesFromText, pliesKey, type Ply } from "@/lib/game";
import type { MoveReview, ReviewState } from "@/lib/review";
import { SHAPE_COLORS, isArrow, sanitizeShapes, type Shape } from "@/lib/shapes";

export type AnalysisExport = {
  plies: Ply[];
  review: ReviewState | null;
  shapes: Record<string, Shape[]>;
  opening?: { eco: string; name: string } | null;
  accuracy?: { white: number; black: number } | null;
};

const NAG: Partial<Record<Judgment, string>> = { brilliant: "$3", great: "$1", inaccuracy: "$6", mistake: "$2", blunder: "$4" };

function evalTag(value: WhiteEval) {
  if (value.mate != null) return `#${value.mate}`;
  return (value.cp / 100).toFixed(2);
}

function clean(text: string) {
  return text.replace(/[{}\n\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function shapeTags(list: Shape[] | undefined) {
  if (!list || list.length === 0) return "";
  const squares = list.filter((shape) => !isArrow(shape)).map((shape) => `${SHAPE_COLORS[shape.color].letter}${shape.from}`);
  const arrows = list.filter(isArrow).map((shape) => `${SHAPE_COLORS[shape.color].letter}${shape.from}${shape.to}`);
  return [squares.length ? `[%csl ${squares.join(",")}]` : "", arrows.length ? `[%cal ${arrows.join(",")}]` : ""].filter(Boolean).join(" ");
}

function resultTag(fen: string) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return chess.turn() === "w" ? "0-1" : "1-0";
  if (chess.isDraw() || chess.isStalemate()) return "1/2-1/2";
  return "*";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** PGN comentado, com [%eval], setas e casas ([%cal]/[%csl]) e a categoria de cada lance. Abre no Lichess e no ChessBase. */
export function buildAnnotatedPgn(input: AnalysisExport): string {
  const { plies, review, shapes, opening, accuracy } = input;
  const now = new Date();
  const headers: Array<[string, string]> = [
    ["Event", "Análise Byte Chess"],
    ["Site", "Byte Chess"],
    ["Date", `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`],
    ["Round", "-"],
    ["White", "Brancas"],
    ["Black", "Pretas"],
    ["Result", resultTag(plies[plies.length - 1]?.fen ?? START_FEN)],
    ["Annotator", "Byte Chess"],
  ];
  if (opening?.eco) headers.push(["ECO", opening.eco]);
  if (opening?.name) headers.push(["Opening", opening.name]);
  if (accuracy) {
    headers.push(["WhiteAccuracy", accuracy.white.toFixed(1)], ["BlackAccuracy", accuracy.black.toFixed(1)]);
  }
  if (!isStandardStart(plies)) headers.push(["SetUp", "1"], ["FEN", plies[0].fen]);

  const start = new Chess(plies[0]?.fen ?? START_FEN);
  let moveNumber = start.moveNumber();
  let turn = start.turn();
  const parts: string[] = [];
  const rootShapes = shapeTags(shapes[plies[0]?.fen ?? ""]);
  if (rootShapes) parts.push(`{ ${rootShapes} }`);
  let afterComment = Boolean(rootShapes);

  for (let index = 1; index < plies.length; index += 1) {
    const ply = plies[index];
    if (!ply.san) break;
    if (turn === "w") parts.push(`${moveNumber}.`);
    else if (index === 1 || afterComment) parts.push(`${moveNumber}...`);
    parts.push(ply.san);
    const item: MoveReview | undefined = review?.moves[index];
    const nag = item ? NAG[item.judgment] : undefined;
    if (nag) parts.push(nag);
    const bits: string[] = [];
    if (item) bits.push(`[%eval ${evalTag(item.evalAfter)}]`);
    const tags = shapeTags(shapes[ply.fen]);
    if (tags) bits.push(tags);
    if (item) {
      const showBest = !["book", "best", "brilliant", "great"].includes(item.judgment);
      const alt = showBest && item.bestUci !== ply.uci && item.bestSan ? ` Melhor era ${item.bestSan}.` : "";
      bits.push(`${JUDGMENT_META[item.judgment].label}. ${item.note}${alt}`);
    }
    afterComment = bits.length > 0;
    if (bits.length > 0) parts.push(`{ ${clean(bits.join(" "))} }`);
    if (turn === "b") moveNumber += 1;
    turn = turn === "w" ? "b" : "w";
  }
  parts.push(resultTag(plies[plies.length - 1]?.fen ?? START_FEN));

  const head = headers.map(([key, value]) => `[${key} "${value.replace(/"/g, "'")}"]`).join("\n");
  return `${head}\n\n${wrap(parts.join(" "))}\n`;
}

/** Quebra linhas só entre lances; cada comentário { ... } fica inteiro (ferramentas leem [%eval] numa linha só). */
function wrap(text: string, width = 96) {
  const lines: string[] = [];
  let line = "";
  for (const token of text.match(/\{[^}]*\}|\S+/g) ?? []) {
    if (line && line.length + token.length + 1 > width) {
      lines.push(line);
      line = token;
    } else line = line ? `${line} ${token}` : token;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export const ANALYSIS_FORMAT = "byte-chess-analysis";

/** Arquivo próprio do Byte Chess: tem tudo que é preciso para reabrir a análise exatamente como estava. */
export function buildAnalysisJson(input: AnalysisExport): string {
  const { plies, review, shapes } = input;
  return JSON.stringify(
    {
      format: ANALYSIS_FORMAT,
      version: 1,
      savedAt: new Date().toISOString(),
      startFen: plies[0]?.fen ?? START_FEN,
      moves: plies.slice(1).map((ply) => ply.uci ?? ""),
      review: review ? { status: review.status, progress: review.progress, total: review.total, partial: review.partial, moves: review.moves } : null,
      shapes,
    },
    null,
    1,
  );
}

export type LoadedAnalysis = { plies: Ply[]; review: ReviewState | null; shapes: Record<string, Shape[]>; kind: "analysis" | "pgn" };

function validEval(value: unknown): value is WhiteEval {
  const item = value as WhiteEval | null;
  return Boolean(item) && typeof item?.cp === "number" && (item.mate === null || typeof item.mate === "number");
}

function validMove(value: unknown): value is MoveReview {
  const item = value as MoveReview | null;
  return (
    Boolean(item) &&
    JUDGMENT_ORDER.includes(item?.judgment as Judgment) &&
    typeof item?.accuracy === "number" &&
    typeof item?.note === "string" &&
    typeof item?.bestUci === "string" &&
    validEval(item?.evalBefore) &&
    validEval(item?.evalAfter)
  );
}

/** Lê um arquivo de análise (.json do Byte Chess) ou um PGN/FEN comum. Devolve null se não reconhecer. */
export function parseAnalysisFile(text: string): LoadedAnalysis | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as {
        format?: string;
        startFen?: string;
        moves?: unknown;
        review?: { status?: string; progress?: number; total?: number; partial?: boolean; moves?: Record<string, unknown> } | null;
        shapes?: Record<string, unknown>;
      };
      if (data.format !== ANALYSIS_FORMAT || !Array.isArray(data.moves)) return null;
      const chess = new Chess(typeof data.startFen === "string" ? data.startFen : START_FEN);
      let plies: Ply[] = [{ fen: chess.fen() }];
      for (const uci of data.moves) {
        if (typeof uci !== "string" || uci.length < 4) return null;
        const next = appendMove(plies, plies[plies.length - 1].fen, uci.slice(0, 2) as never, uci.slice(2, 4) as never, (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined);
        if (!next) return null;
        plies = next.plies;
      }
      let review: ReviewState | null = null;
      if (data.review?.moves) {
        const moves: ReviewState["moves"] = {};
        for (const [index, value] of Object.entries(data.review.moves)) {
          const n = Number(index);
          if (Number.isInteger(n) && n >= 1 && n < plies.length && validMove(value)) moves[n] = value;
        }
        const done = Object.keys(moves).length;
        review = {
          key: pliesKey(plies),
          status: "done",
          progress: done,
          total: plies.length - 1,
          partial: done < plies.length - 1,
          moves,
        };
      }
      const shapes: Record<string, Shape[]> = {};
      for (const [fen, list] of Object.entries(data.shapes ?? {})) shapes[fen] = sanitizeShapes(list);
      return { plies, review, shapes, kind: "analysis" };
    } catch {
      return null;
    }
  }
  const plies = pliesFromText(trimmed);
  return plies ? { plies, review: null, shapes: {}, kind: "pgn" } : null;
}

export function safeFileName(base: string) {
  return base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "analise";
}

/** Baixa um texto como arquivo (dispara o "Salvar como" do navegador). */
export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
