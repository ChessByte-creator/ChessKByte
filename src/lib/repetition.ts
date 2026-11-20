import { Chess } from "chess.js";

type HasFen = { fen: string };

/** Posição para fins de repetição: peças, vez, roques e en passant (sem os contadores de lances). */
export function positionKey(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

/** Quantas vezes a posição `fen` (por padrão a última) já aconteceu na partida, contando ela mesma. */
export function repetitionCount(plies: HasFen[], fen: string | undefined = plies[plies.length - 1]?.fen) {
  if (!fen) return 0;
  const key = positionKey(fen);
  let count = 0;
  for (const ply of plies) if (positionKey(ply.fen) === key) count += 1;
  return count;
}

export function isThreefold(plies: HasFen[]) {
  return repetitionCount(plies) >= 3;
}

/** Posições que ainda não podem repetir (depois de captura ou lance de peão elas não voltam): corta a busca. */
function reversibleTail(plies: HasFen[]) {
  const last = plies[plies.length - 1];
  const clock = Number(last?.fen.split(" ")[4] ?? 0);
  return Number.isFinite(clock) && clock > 0 ? plies.slice(Math.max(0, plies.length - 1 - clock)) : plies.slice(-1);
}

export type RepetitionMove = { uci: string; /** vezes que a posição criada pelo lance já ocorreu */ seen: number; draws: boolean };

/** Para cada lance legal: a posição que ele cria já ocorreu quantas vezes? `draws` = completa a terceira. */
export function repetitionOfMoves(plies: HasFen[]): RepetitionMove[] {
  const last = plies[plies.length - 1];
  if (!last) return [];
  const tail = reversibleTail(plies);
  const counts = new Map<string, number>();
  for (const ply of tail) counts.set(positionKey(ply.fen), (counts.get(positionKey(ply.fen)) ?? 0) + 1);
  const chess = new Chess(last.fen);
  const out: RepetitionMove[] = [];
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const seen = counts.get(positionKey(chess.fen())) ?? 0;
    chess.undo();
    out.push({ uci: `${move.from}${move.to}${move.promotion ?? ""}`, seen, draws: seen >= 2 });
  }
  return out;
}

/** Pontuação em centipeões do ponto de vista de quem joga; mate vira um valor enorme. */
export function lineScore(scoreCp: number | null, mate: number | null) {
  if (mate != null && mate !== 0) return mate > 0 ? 10000 - mate : -10000 - mate;
  return scoreCp ?? 0;
}

/** Acima disto (a favor do motor) ele foge da repetição; abaixo do negativo disto ele a procura. */
export const REPETITION_CP = 120;

export type RepetitionChoice = { uci: string; changed: boolean; kind: "avoid" | "seek" | null };

/**
 * O lance que o motor escolheu deve ser trocado por causa de repetição?
 * - Ganhando (≥ +1,2): nunca completa a terceira repetição se houver outro lance bom entre as linhas.
 * - Perdendo (≤ −1,2): se existe um lance que completa a terceira repetição, joga ele (vale 0, melhor que perder).
 * - No meio-termo não interfere (o Stockfish, que agora recebe o histórico, já trata a repetição como empate na busca).
 * `candidates` são as linhas do motor (primeiro lance + pontuação de quem joga).
 */
export function chooseWithRepetition(args: {
  plies: HasFen[];
  chosen: string;
  botCp: number;
  candidates: Array<{ uci: string; score: number }>;
}): RepetitionChoice {
  const keep: RepetitionChoice = { uci: args.chosen, changed: false, kind: null };
  if (args.plies.length < 5) return keep;
  const moves = repetitionOfMoves(args.plies);
  const byUci = new Map(moves.map((move) => [move.uci, move]));
  if (args.botCp >= REPETITION_CP) {
    if (!byUci.get(args.chosen)?.draws) return keep;
    const alternatives = args.candidates.filter((item) => item.uci !== args.chosen && byUci.has(item.uci) && !byUci.get(item.uci)?.draws).sort((a, b) => b.score - a.score);
    const best = alternatives.find((item) => item.score >= REPETITION_CP / 2) ?? alternatives[0];
    return best ? { uci: best.uci, changed: true, kind: "avoid" } : keep;
  }
  if (args.botCp <= -REPETITION_CP) {
    if (byUci.get(args.chosen)?.draws) return keep;
    const drawing = moves.filter((move) => move.draws);
    if (drawing.length === 0) return keep;
    const scored = drawing.map((move) => ({ move, score: args.candidates.find((item) => item.uci === move.uci)?.score ?? -Infinity }));
    scored.sort((a, b) => b.score - a.score);
    return { uci: scored[0].move.uci, changed: true, kind: "seek" };
  }
  return keep;
}
