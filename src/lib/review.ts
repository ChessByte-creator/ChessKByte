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
 * Saldo de material do jogador (dele menos do adversário) em relação ao início da linha, no pior ponto
 * "assentado": depois da resposta do adversário e sem troca em andamento. O próprio lance nunca reduz
 * o material de quem joga; é preciso olhar a continuação. Devolve null se a linha for curta demais.
 */
export function settledMaterialDelta(beforeFen: string, pv: string, color: "w" | "b", horizon = 8): number | null {
  const tokens = pv.trim().split(/\s+/).filter((token) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token));
  if (tokens.length < 2) return null;
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
  let worst: number | null = null;
  for (let t = 2; t <= diffs.length; t += 2) {
    if (t < captures.length && captures[t]) continue; // troca ainda em andamento
    worst = worst === null ? diffs[t - 1] : Math.min(worst, diffs[t - 1]);
  }
  return worst;
}

/** Perda de material de pelo menos 2 pontos na linha do motor (a linha começa no lance jogado). */
export function detectSacrifice(beforeFen: string, pv: string, color: "w" | "b", horizon = 8): boolean {
  const delta = settledMaterialDelta(beforeFen, pv, color, horizon);
  return delta !== null && delta <= -2;
}

/**
 * Sacrifício voluntário: o lance perde material E alguma alternativa do motor mantém pelo menos 2 pontos
 * a mais. Se todas as alternativas também perdem (ataque descoberto, peça já ameaçada, xeque), a perda
 * é obrigatória e não conta como sacrifício.
 */
export function isVoluntarySacrifice(beforeFen: string, playedPv: string, otherPvs: string[], color: "w" | "b"): boolean {
  const played = settledMaterialDelta(beforeFen, playedPv, color);
  if (played === null || played > -2) return false;
  return otherPvs.some((pv) => {
    const alt = settledMaterialDelta(beforeFen, pv, color);
    return alt !== null && alt >= played + 2;
  });
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
  /** Melhor lance de uma busca rasa (profundidade 4), quando já foi consultada. */
  shallowBest?: string;
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

  // A avaliação depois do lance vem, sempre que possível, de uma busca independente da posição seguinte
  // (como na Lichess). Assim um lance que o motor "escolheu" mas que a busca seguinte desmente perde pontos.
  let evalAfter = evalBefore;
  if (afterEval) evalAfter = afterEval;
  else if (!playedBest) {
    if (playedLine) evalAfter = toWhiteEval(playedLine.scoreCp, playedLine.mate, turn);
  }

  const beforeMover = moverCp(evalBefore, color);
  const afterMover = moverCp(evalAfter, color);
  const winBefore = cpToWinPercent(beforeMover);
  const winAfter = cpToWinPercent(afterMover);
  const winLoss = forced ? 0 : Math.max(0, winBefore - winAfter);
  const lossCp = forced ? 0 : Math.max(0, beforeMover - afterMover);

  // Melhor alternativa ao lance jogado.
  const alt = lines.find((line) => firstMove(line.pv) !== uci);
  const altWin = alt ? cpToWinPercent(moverCp(toWhiteEval(alt.scoreCp, alt.mate, turn), color)) : winBefore;
  const gap = alt ? Math.max(0, winBefore - altWin) : 0;

  const pvForPlayed = playedLine?.pv ?? (uci === bestUci ? top?.pv : undefined) ?? "";
  const otherPvs = lines.filter((line) => firstMove(line.pv) !== uci).map((line) => line.pv);
  const sacrifice = !forced && !inBook && pvForPlayed ? isVoluntarySacrifice(beforeFen, pvForPlayed, otherPvs, color) : false;
  const bestIsMate = top?.mate != null && top.mate !== 0 && (turn === color ? top.mate > 0 : top.mate < 0);
  const nearlyForced = legalCount <= 2 || (before.inCheck() && legalCount <= 3);
  const trial = new Chess(beforeFen);
  let quiet = false;
  try {
    const moved = trial.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined });
    quiet = !moved.isCapture() && !moved.promotion && !moved.san.includes("+") && !moved.san.includes("#");
  } catch {
    quiet = false;
  }
  const obvious = input.shallowBest !== undefined && input.shallowBest === uci;

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
    quiet,
    obvious,
    nearlyForced,
    recapture,
    prevOpponentLoss,
    bestIsMate,
  });

  const accuracy = forced || inBook ? 100 : moveAccuracy(winBefore, winAfter);
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
