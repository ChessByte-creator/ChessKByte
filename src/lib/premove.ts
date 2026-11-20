import { Chess, type Square } from "chess.js";

export type Premove = { from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" };

function fileRank(square: Square) {
  return { file: square.charCodeAt(0) - 97, rank: Number(square[1]) };
}

function toSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${String.fromCharCode(97 + file)}${rank}` as Square;
}

/**
 * Casas possíveis para um premove: os lances da peça como se fosse a vez dela.
 * Ignora a vez e xeques do adversário (a posição vai mudar), e aceita capturas de peão em casa vazia.
 * A legalidade de verdade é conferida quando o premove é executado.
 */
export function premoveTargets(fen: string, from: Square): Square[] {
  const base = new Chess(fen);
  const piece = base.get(from);
  if (!piece) return [];
  const parts = fen.split(" ");
  parts[1] = piece.color;
  parts[3] = "-";
  let flipped: Chess;
  try {
    flipped = new Chess(parts.join(" "));
  } catch {
    return [];
  }
  const targets = new Set<Square>(flipped.moves({ square: from, verbose: true }).map((move) => move.to));
  if (piece.type === "p") {
    const { file, rank } = fileRank(from);
    const step = piece.color === "w" ? 1 : -1;
    for (const df of [-1, 1]) {
      const sq = toSquare(file + df, rank + step);
      if (sq && base.get(sq)?.color !== piece.color) targets.add(sq);
    }
  }
  return [...targets];
}

/** O premove é legal na posição atual? Devolve o lance com promoção definida (sempre dama) ou null. */
export function resolvePremove(fen: string, premove: Premove): Premove | null {
  try {
    const options = new Chess(fen).moves({ square: premove.from, verbose: true }).filter((move) => move.to === premove.to);
    if (options.length === 0) return null;
    const promo = options.find((move) => move.promotion === "q") ?? options[0];
    return { from: premove.from, to: premove.to, promotion: (promo.promotion as Premove["promotion"]) ?? undefined };
  } catch {
    return null;
  }
}

/** Máximo de premoves em fila. */
export const MAX_PREMOVES = 10;

/**
 * Posição "virtual" depois de executar os premoves em fila (só move as peças, sem checar a vez).
 * É nela que o jogador escolhe o próximo premove e é ela que o tabuleiro mostra.
 */
export function applyPremoves(fen: string, premoves: Premove[]): string {
  const chess = new Chess(fen);
  for (const move of premoves) {
    const piece = chess.get(move.from);
    if (!piece) continue;
    chess.remove(move.from);
    // en passant: peão anda na diagonal para casa vazia
    if (piece.type === "p" && move.from[0] !== move.to[0] && !chess.get(move.to)) {
      chess.remove(`${move.to[0]}${move.from[1]}` as Square);
    }
    chess.remove(move.to);
    const lastRank = piece.color === "w" ? "8" : "1";
    const type = piece.type === "p" && move.to[1] === lastRank ? (move.promotion ?? "q") : piece.type;
    chess.put({ type, color: piece.color }, move.to);
    // roque: leva a torre junto
    if (piece.type === "k" && Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) === 2) {
      const rank = move.from[1];
      const kingside = move.to.charCodeAt(0) > move.from.charCodeAt(0);
      const rookFrom = `${kingside ? "h" : "a"}${rank}` as Square;
      const rookTo = `${kingside ? "f" : "d"}${rank}` as Square;
      const rook = chess.get(rookFrom);
      if (rook?.type === "r") {
        chess.remove(rookFrom);
        chess.put(rook, rookTo);
      }
    }
  }
  return chess.fen();
}
