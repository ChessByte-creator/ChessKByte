import { Chess, type Square } from "chess.js";

/**
 * Táticas estáticas para a revisão: peças "no ar" (en prise) e sacrifícios, calculadas só com as regras
 * (troca de capturas na mesma casa), sem depender do que o motor mostra na linha principal.
 */

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const SQUARES: Square[] = [];
for (const file of "abcdefgh") for (const rank of "12345678") SQUARES.push(`${file}${rank}` as Square);

type Promo = "q" | "r" | "b" | "n";

/**
 * Quanto o lado que joga ganha trocando capturas na casa `square` (nunca menos que 0: pode parar).
 * Segue a regra clássica da troca estática: cada lado captura com a peça de menor valor que alcança a casa.
 */
function exchangeGain(chess: Chess, square: Square, depth: number): number {
  if (depth <= 0) return 0;
  let pick: ReturnType<Chess["moves"]>[number] | null = null;
  let pickRank = Infinity;
  for (const move of chess.moves({ verbose: true })) {
    if (move.to !== square || !move.captured) continue;
    // promoção primeiro (vale mais), depois a peça mais barata
    const rank = move.promotion ? -1 : (PIECE_VALUE[move.piece] ?? 0);
    if (rank < pickRank) {
      pickRank = rank;
      pick = move;
    }
  }
  if (!pick || !pick.captured) return 0;
  const gained = (PIECE_VALUE[pick.captured] ?? 0) + (pick.promotion ? (PIECE_VALUE[pick.promotion] ?? 0) - 1 : 0);
  chess.move(pick.san);
  const reply = exchangeGain(chess, square, depth - 1);
  chess.undo();
  return Math.max(0, gained - reply);
}

/** Vira o turno sem jogar (para perguntar "e se o adversário pudesse capturar agora?"). */
function withTurn(fen: string, turn: "w" | "b"): Chess | null {
  const parts = fen.split(" ");
  if (parts.length < 4) return null;
  parts[1] = turn;
  parts[3] = "-";
  try {
    return new Chess(parts.join(" "));
  } catch {
    return null;
  }
}

export type HangingPiece = { square: Square; piece: string; loss: number };

/**
 * Peças de `color` (cavalo, bispo, torre ou dama) que o adversário pode capturar com ganho líquido de
 * pelo menos `minNet` pontos (já contando as recapturas), supondo que seja a vez do adversário.
 */
export function hangingPieces(fen: string, color: "w" | "b", minNet = 2): HangingPiece[] {
  const enemy = color === "w" ? "b" : "w";
  const chess = withTurn(fen, enemy);
  if (!chess) return [];
  const out: HangingPiece[] = [];
  for (const square of SQUARES) {
    const piece = chess.get(square);
    if (!piece || piece.color !== color || piece.type === "p" || piece.type === "k") continue;
    if ((PIECE_VALUE[piece.type] ?? 0) < 3) continue;
    if (!chess.isAttacked(square, enemy)) continue;
    const loss = exchangeGain(chess, square, 8);
    if (loss >= minNet) out.push({ square, piece: piece.type, loss });
  }
  return out;
}

/** Perda líquida mínima para contar uma peça que NÃO é a que se moveu (defesa abandonada, peça descoberta). */
const OTHER_MIN = 3;
/** Perda líquida mínima para contar uma peça que JÁ estava em prise (continuação de combinação). */
const INHERITED_MIN = 5;
/** Idem, quando é a própria peça que muda de uma casa atacada para outra. */
const INHERITED_MOVED_MIN = 3;

export type SacrificeInfo = {
  piece: string;
  square: Square;
  /** Perda líquida de material se o adversário capturar: depois das recapturas e descontando o que o lance capturou. */
  loss: number;
} | null;

/** Existe um lance legal (que não seja o jogado) depois do qual a peça em `square` deixa de estar em prise? */
function hasSafeAlternative(beforeFen: string, playedUci: string, color: "w" | "b", square: Square): boolean {
  let chess: Chess;
  try {
    chess = new Chess(beforeFen);
  } catch {
    return false;
  }
  // Tenta primeiro os lances da própria peça ameaçada (a saída mais comum), depois os demais.
  const moves = chess.moves({ verbose: true }).sort((a, b) => Number(b.from === square) - Number(a.from === square));
  for (const move of moves) {
    if (`${move.from}${move.to}${move.promotion ?? ""}` === playedUci) continue;
    chess.move(move.san);
    const where = move.from === square ? move.to : square;
    const stillHanging = hangingPieces(chess.fen(), color).some((item) => item.square === where);
    chess.undo();
    if (!stillHanging) return true;
  }
  return false;
}

/**
 * Sacrifício VOLUNTÁRIO: depois do lance, uma peça nossa (cavalo, bispo, torre ou dama) fica em prise com
 * perda líquida de 2+ pontos (depois das recapturas, descontando o que o lance capturou). Peão nunca conta.
 * - Se a peça NÃO estava em prise antes, o lance a entregou: é sacrifício.
 * - Se já estava em prise e o lance a deixa lá, só conta se algum outro lance a salvaria
 *   (ex.: dama atacada que o jogador abandona de propósito). Se nenhum lance salva, é problema herdado, não escolha.
 * - Se a própria peça ameaçada se move para outra casa ameaçada, não é sacrifício.
 */
export function newSacrifice(beforeFen: string, uci: string): SacrificeInfo {
  let before: Chess;
  try {
    before = new Chess(beforeFen);
  } catch {
    return null;
  }
  const color = before.turn();
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const alreadyHanging = new Set(hangingPieces(beforeFen, color).map((item) => item.square));
  let after: Chess;
  let taken = 0;
  try {
    after = new Chess(beforeFen);
    const moved = after.move({ from, to, promotion: uci.length > 4 ? (uci[4] as Promo) : undefined });
    taken = moved.captured ? (PIECE_VALUE[moved.captured] ?? 0) : 0;
  } catch {
    return null;
  }
  let worst: SacrificeInfo = null;
  for (const item of hangingPieces(after.fen(), color)) {
    // Perda líquida: o que o adversário ganha menos o que o próprio lance acabou de capturar.
    const net = item.loss - taken;
    const movedPiece = item.square === to;
    // A peça que o lance move vale a partir de 2 (troca de qualidade: torre por bispo). Uma peça que fica
    // pendurada porque o lance tirou a defesa dela (como a dama que abandona o cavalo) só vale se for 3+.
    if (net < (movedPiece ? 2 : OTHER_MIN)) continue;
    const inherited = alreadyHanging.has(item.square) || (movedPiece && alreadyHanging.has(from));
    if (inherited) {
      // Peça que já estava em prise: o lance só "oferece" de novo se ela é grande (a continuação de uma
      // combinação, como o Qc3 que deixa a torre pendurada) e se havia saída segura. Peça pequena herdada
      // (um cavalo que continua pendurado) é problema da combinação, não um sacrifício novo.
      // A própria peça que vai de uma casa atacada para outra também vale, se ela tinha para onde fugir.
      if (net < (movedPiece ? INHERITED_MOVED_MIN : INHERITED_MIN)) continue;
      if (!hasSafeAlternative(beforeFen, uci, color, item.square)) continue;
    }
    if (!worst || net > worst.loss) worst = { piece: item.piece, square: item.square, loss: net };
  }
  return worst;
}

/** O lance captura uma peça que estava de graça (ganho líquido ≥ 2 sem risco)? Então é só pegar, não é um achado. */
export function isFreeCapture(beforeFen: string, uci: string): boolean {
  try {
    const chess = new Chess(beforeFen);
    const move = chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? (uci[4] as Promo) : undefined });
    if (!move.captured) return false;
    const gained = PIECE_VALUE[move.captured] ?? 0;
    if (gained < 3) return false;
    return gained - exchangeGain(chess, move.to as Square, 8) >= 2;
  } catch {
    return false;
  }
}
