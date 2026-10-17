import { Chess, type Square } from "chess.js";
import type { EngineLine } from "@/lib/engine";
import { isFreeCapture, newSacrifice, PIECE_VALUE } from "@/lib/tactics";
import {
  BRILLIANT_MAX_LOSS,
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
  /** Profundidade que o motor realmente alcançou na posição antes e depois do lance (o tempo limite pode cortar a busca). */
  /** Chance de vitória de quem jogou antes do lance (0–100). */
  winBefore?: number;
  depthBefore?: number;
  depthAfter?: number;
  /** A avaliação foi confirmada com uma busca mais funda (lance perto da divisa de categoria, ou ótimo/brilhante). */
  confirmed?: boolean;
  /** Entradas do classificador (para depuração e testes). */
  trace?: import("@/lib/eval").MoveClassInput;
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

function materialOf(chess: Chess, color: "w" | "b") {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece) total += (piece.color === color ? 1 : -1) * (PIECE_VALUE[piece.type] ?? 0);
    }
  }
  return total;
}

/**
 * A peça entregue é recuperada logo em seguida, na própria linha do motor? Se o adversário captura a peça
 * entregue (em `square`) e, em algum ponto assentado da linha (sem troca em andamento), o material volta a ser igual ou melhor
 * que no início, é só uma tática que ganha material, não um sacrifício. Se o adversário não captura
 * (peça envenenada) ou a linha segue com déficit, continua valendo como sacrifício.
 */
export function isTemporarySacrifice(beforeFen: string, pv: string, color: "w" | "b", square: string, horizon = 8): boolean {
  const tokens = pv.trim().split(/\s+/).filter((token) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token));
  if (tokens.length < 3) return false;
  const chess = new Chess(beforeFen);
  const base = materialOf(chess, color);
  const limit = Math.min(tokens.length, horizon);
  const captures: boolean[] = [];
  const deltas: number[] = [];
  let tookPiece = false;
  for (let i = 0; i < limit; i += 1) {
    const moved = playToken(chess, tokens[i]);
    if (!moved) break;
    captures.push(moved.isCapture() || Boolean(moved.promotion));
    deltas.push(materialOf(chess, color) - base);
    // O adversário tem que capturar justamente a peça entregue (trocas de outras peças não contam).
    if (i % 2 === 1 && i <= 3 && moved.to === square && moved.captured && (PIECE_VALUE[moved.captured] ?? 0) >= 3) tookPiece = true;
  }
  if (!tookPiece) return false;
  for (let t = 2; t <= deltas.length; t += 2) {
    if (t < captures.length && captures[t]) continue; // troca ainda em andamento
    if (deltas[t - 1] >= 0) return true;
  }
  return false;
}

export function firstMove(pv: string) {
  return pv.trim().split(/\s+/)[0] ?? "";
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
  /** Continuação de uma combinação já premiada que o motor tinha previsto (ver `continuesLine`). */
  inChain?: boolean;
  /** Devolve as entradas do classificador em `trace` (só para testes: não vai para a análise salva). */
  trace?: boolean;
};

/**
 * O lance é a continuação que o motor já tinha na linha principal duas jogadas antes?
 * `prevLines` é a busca da posição ANTES do lance anterior (do adversário); a linha principal dela deve
 * começar com o lance que o adversário jogou e continuar com o lance atual. Se sim, nada foi "descoberto" aqui:
 * o motor já enxergava a sequência inteira.
 */
export function continuesLine(prevLines: EngineLine[] | undefined, prevUci: string | undefined, uci: string): boolean {
  if (!prevLines || !prevUci) return false;
  const top = prevLines.find((line) => line.multipv === 1) ?? prevLines[0];
  if (!top) return false;
  const tokens = top.pv.trim().split(/\s+/);
  return tokens[0] === prevUci && tokens[1] === uci;
}

const ZERO: WhiteEval = { cp: 0, mate: null };

/** Um lance sem sacrifício a esta distância (em pontos de chance de vitória) do melhor torna o sacrifício dispensável. */
const QUIET_ALT_WINDOW = 1;

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

  // Melhor alternativa ao lance jogado (outra primeira jogada nas linhas do motor).
  const others = lines.filter((line) => firstMove(line.pv) !== uci).sort((a, b) => a.multipv - b.multipv);
  const winOf = (line: EngineLine) => cpToWinPercent(moverCp(toWhiteEval(line.scoreCp, line.mate, turn), color));
  const secondWin = others[0] ? winOf(others[0]) : null;
  const gap = playedBest && secondWin !== null ? Math.max(0, winBefore - secondWin) : 0;

  // Sacrifício voluntário: calculado pelas regras (peça deixada em prise, que não estava), não pela linha do motor.
  // (só para lances que não perderam chance: o resto não pode ser brilhante e a conta não é barata)
  const sacInfo = !forced && !inBook && winLoss < BRILLIANT_MAX_LOSS ? newSacrifice(beforeFen, uci) : null;
  const playedPv = playedLine?.pv ?? (uci === bestUci ? top?.pv : undefined) ?? "";
  // Torre ou dama oferecida continua sendo sacrifício mesmo que a linha devolva material depois (combinação);
  // só peça menor que volta na troca imediata é "tática que ganha material".
  const bigOffer = sacInfo !== null && (PIECE_VALUE[sacInfo.piece] ?? 0) >= 5;
  const sacrifice = sacInfo !== null && (bigOffer || !(playedPv && isTemporarySacrifice(beforeFen, playedPv, color, sacInfo.square)));
  // Se existe um lance sem sacrifício que o motor acha quase tão bom, o sacrifício não era necessário.
  const quietAltClose =
    sacrifice &&
    others.some((line) => {
      if (winOf(line) < winBefore - QUIET_ALT_WINDOW) return false;
      const move = firstMove(line.pv);
      return move.length >= 4 && newSacrifice(beforeFen, move) === null;
    });

  const bestIsMate = top?.mate != null && top.mate !== 0 && (turn === color ? top.mate > 0 : top.mate < 0);
  const nearlyForced = legalCount <= 2 || (before.inCheck() && legalCount <= 4);
  let quiet = false;
  let givesCheck = false;
  try {
    const trial = new Chess(beforeFen);
    const moved = trial.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined });
    givesCheck = moved.san.includes("+") || moved.san.includes("#");
    quiet = !sacrifice && !moved.isCapture() && !moved.promotion && !moved.san.includes("+") && !moved.san.includes("#");
  } catch {
    quiet = false;
  }
  const obvious = input.shallowBest !== undefined && input.shallowBest === uci;

  const clsInput = {
    winLoss,
    winBefore,
    winAfter,
    playedBest,
    forced,
    legalCount,
    nearlyForced,
    recapture,
    book: inBook,
    gap,
    secondWin,
    sacrifice,
    quietAltClose,
    quiet,
    obvious,
    freeCapture: !forced && isFreeCapture(beforeFen, uci),
    inChain: input.inChain ?? false,
    prevOpponentLoss,
    bestIsMate,
    ply: input.seed ?? 99,
    inCheck: before.inCheck(),
    givesCheck,
  };
  const judgment = classifyMove(clsInput);

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
    winBefore,
    ...(input.trace ? { trace: clsInput } : {}),
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
