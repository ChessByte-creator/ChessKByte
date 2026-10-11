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
