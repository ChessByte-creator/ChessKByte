import { Chess, type Move } from "chess.js";
import type { Ply } from "@/lib/game";

/**
 * O En Croissant guarda cada lance em 1 byte: o índice do lance na lista `legal_moves()` da biblioteca Rust
 * `shakmaty` (a posição de cada lance na lista, não "de/para"). Para decodificar, precisamos gerar os lances
 * legais NA MESMA ORDEM. Aqui usamos o chess.js só para saber quais lances são legais e reordenamos pela
 * ordem de geração do shakmaty (position.rs, `legal_moves`):
 *
 *  1. en passant (por casa de origem)
 *  2. se NÃO está em xeque: capturas de peão para o lado "oeste" (colunas menores), depois "leste"
 *     (cada lado: sem promoção, depois com promoção Q,R,B,N), avanço de 1, avanço de 1 com promoção,
 *     avanço de 2, cavalos, bispos, torres, damas (cada peça por casa de origem e depois destino),
 *     rei (por destino), roque curto, roque longo
 *  3. se está em xeque: rei primeiro, depois o mesmo bloco de peças (sem roque)
 *
 * Casas contam de a1=0 até h8=63 e cada grupo é percorrido em ordem crescente.
 */

const PROMO_ORDER: Record<string, number> = { q: 0, r: 1, b: 2, n: 3 };

function square(name: string) {
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}

function key(move: Move, inCheck: boolean): [number, number, number] {
  const from = square(move.from);
  const to = square(move.to);
  if (move.flags.includes("e")) return [0, from, 0];
  if (move.flags.includes("k")) return [14, 0, 0];
  if (move.flags.includes("q")) return [15, 0, 0];
  if (move.piece === "k") return [inCheck ? 1 : 13, to, 0];
  if (move.piece === "p") {
    const promo = move.promotion ? PROMO_ORDER[move.promotion] : 0;
    if (move.flags.includes("c")) {
      const west = to % 8 < from % 8;
      const base = west ? 2 : 4;
      return [move.promotion ? base + 1 : base, to, promo];
    }
    if (move.flags.includes("b")) return [8, to, 0];
    return [move.promotion ? 7 : 6, to, promo];
  }
  const group = move.piece === "n" ? 9 : move.piece === "b" ? 10 : move.piece === "r" ? 11 : 12;
  return [group, from, to];
}

/** Lances legais da posição, na ordem do shakmaty (o byte do En Croissant é o índice nesta lista). */
export function legalMovesInEcOrder(chess: Chess): Move[] {
  const inCheck = chess.inCheck();
  return chess
    .moves({ verbose: true })
    .map((move) => ({ move, k: key(move, inCheck) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
    .map((entry) => entry.move);
}

export type DecodedGame = {
  plies: Ply[];
  /** Lances em SAN, separados por espaço (mesmo formato de `GameRecord.moves`). */
  san: string;
  /** false se algum byte não correspondia a um lance legal (arquivo corrompido ou ordem diferente). */
  ok: boolean;
};

/** Decodifica a coluna `Moves` (1 byte por lance). `startFen` vem da coluna FEN quando a partida não começa do início. */
export function decodeEcMoves(blob: Uint8Array, startFen?: string | null): DecodedGame {
  let chess: Chess;
  try {
    chess = startFen ? new Chess(startFen) : new Chess();
  } catch {
    chess = new Chess();
  }
  const plies: Ply[] = [{ fen: chess.fen() }];
  const san: string[] = [];
  let ok = true;
  for (const byte of blob) {
    const list = legalMovesInEcOrder(chess);
    const move = list[byte];
    if (!move) {
      ok = false;
      break;
    }
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    san.push(move.san);
    plies.push({ fen: chess.fen(), san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ""}`, color: move.color, from: move.from, to: move.to });
  }
  return { plies, san: san.join(" "), ok };
}
