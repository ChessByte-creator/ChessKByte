import { Chess, type Square } from "chess.js";
import type { EngineLine } from "@/lib/engine";
import {
  classifyMove,
  cpToWinPercent,
  moveAccuracy,
  moveNote,
  moverCp,
  toWhiteEval,
  type Judgment,
  type WhiteEval,
} from "@/lib/eval";

export type MoveReview = {
  judgment: Judgment;
  lossCp: number;
  winLoss: number;
  accuracy: number;
  note: string;
  bestUci: string;
  bestSan: string;
  evalBefore: WhiteEval;
  evalAfter: WhiteEval;
  forced: boolean;
  sacrifice: boolean;
};

/** Estado da revisão de uma partida (guardado por chave: posição inicial + lances). */
export type ReviewState = {
  key: string;
  status: "running" | "done";
  progress: number;
  total: number;
  partial: boolean;
  moves: Record<number, MoveReview>;
};

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function material(chess: Chess, color: "w" | "b") {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) total += PIECE_VALUE[piece.type] ?? 0;
    }
  }
  return total;
}

function balance(chess: Chess, color: "w" | "b") {
  return material(chess, color) - material(chess, color === "w" ? "b" : "w");
}

function playToken(chess: Chess, uci: string) {
  try {
    return chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
    });
  } catch {
    return null;
  }
}

export function firstMove(pv: string) {
  return pv.trim().split(/\s+/)[0] ?? "";
}

/**
 * Sacrifício = o jogador fica pelo menos 2 pontos de material atrás num ponto "assentado"
 * da linha do motor (depois da resposta do adversário, sem troca em andamento).
 * O movimento em si nunca reduz o próprio material; é preciso olhar a continuação.
 */
export function detectSacrifice(beforeFen: string, pv: string, color: "w" | "b", horizon = 8): boolean {
  const tokens = pv.trim().split(/\s+/).filter((token) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token));
  if (tokens.length < 2) return false;
  const chess = new Chess(beforeFen);
  const base = balance(chess, color);
  const captures: boolean[] = [];
  const diffs: number[] = [];
  const limit = Math.min(tokens.length, horizon);
  for (let i = 0; i < limit; i += 1) {
    const moved = playToken(chess, tokens[i]);
    if (!moved) break;
    captures.push(moved.isCapture() || Boolean(moved.promotion));
    diffs.push(balance(chess, color) - base);
  }
  for (let t = 2; t <= diffs.length; t += 2) {
    const exchangeOngoing = t < captures.length && captures[t];
    if (exchangeOngoing) continue;
    if (diffs[t - 1] <= -2) return true;
  }
  return false;
}

export type JudgeInput = {
  beforeFen: string;
  uci: string;
  color: "w" | "b";
  /** MultiPV da posição ANTES do lance, na visão de quem joga. */
  lines: EngineLine[];
  bestUci: string;
  bestSan: string;
  /** Avaliação (visão das brancas) depois do lance, quando ele não está entre as linhas. */
  afterEval?: WhiteEval;
  inBook: boolean;
  recapture: boolean;
  prevOpponentLoss: number;
  seed: number;
};

const ZERO: WhiteEval = { cp: 0, mate: null };

/** Precisa buscar a posição depois do lance? (só quando ele não aparece nas linhas do motor). */
export function needsAfterSearch(lines: EngineLine[], uci: string, bestUci: string) {
  if (uci === bestUci) return false;
  return !lines.some((line) => firstMove(line.pv) === uci);
}

export function judgePly(input: JudgeInput): MoveReview {
  const { beforeFen, uci, color, lines, bestUci, bestSan, afterEval, inBook, recapture, prevOpponentLoss, seed } = input;
  const before = new Chess(beforeFen);
  const turn = before.turn();
  const legalCount = before.moves().length;
  const forced = legalCount === 1;
  const top = lines.find((line) => line.multipv === 1) ?? lines[0];
  const evalBefore = top ? toWhiteEval(top.scoreCp, top.mate, turn) : ZERO;
  const playedBest = forced || uci === bestUci;
  const playedLine = lines.find((line) => firstMove(line.pv) === uci);

  let evalAfter = evalBefore;
  if (!playedBest) {
    if (playedLine) evalAfter = toWhiteEval(playedLine.scoreCp, playedLine.mate, turn);
    else if (afterEval) evalAfter = afterEval;
  }

  const beforeMover = moverCp(evalBefore, color);
  const afterMover = moverCp(evalAfter, color);
  const winBefore = cpToWinPercent(beforeMover);
  const winAfter = cpToWinPercent(afterMover);
  const winLoss = playedBest ? 0 : Math.max(0, winBefore - winAfter);
  const lossCp = playedBest ? 0 : Math.max(0, beforeMover - afterMover);

  // Melhor alternativa ao lance jogado.
  const alt = lines.find((line) => firstMove(line.pv) !== uci);
  const altWin = alt ? cpToWinPercent(moverCp(toWhiteEval(alt.scoreCp, alt.mate, turn), color)) : winBefore;
  const gap = alt ? Math.max(0, winBefore - altWin) : 0;

  const pvForPlayed = playedLine?.pv ?? (uci === bestUci ? top?.pv : undefined) ?? "";
  const sacrifice = !forced && !inBook && pvForPlayed ? detectSacrifice(beforeFen, pvForPlayed, color) : false;
  const bestIsMate = top?.mate != null && top.mate !== 0 && (turn === color ? top.mate > 0 : top.mate < 0);

  const judgment = classifyMove({
    winLoss,
    winBefore,
    winAfter,
    playedBest,
    forced,
    legalCount,
    gap,
    book: inBook,
    sacrifice,
    recapture,
    prevOpponentLoss,
    bestIsMate,
  });

  const accuracy = playedBest || inBook ? 100 : moveAccuracy(winBefore, winAfter);
  return {
    judgment,
    lossCp,
    winLoss,
    accuracy,
    note: moveNote(judgment, bestSan, playedBest, seed),
    bestUci,
    bestSan,
    evalBefore,
    evalAfter,
    forced,
    sacrifice,
  };
}

/** O lance atual recaptura na casa onde o adversário acabou de capturar? */
export function isRecapture(prevFen: string, prevUci: string | undefined, uci: string) {
  if (!prevUci) return false;
  try {
    const board = new Chess(prevFen);
    const prevMove = playToken(board, prevUci);
    if (!prevMove || !prevMove.isCapture()) return false;
    const current = playToken(board, uci);
    return Boolean(current && current.isCapture() && current.to === prevMove.to);
  } catch {
    return false;
  }
}
