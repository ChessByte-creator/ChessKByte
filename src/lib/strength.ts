import { cpToWinPercent } from "@/lib/eval";
import type { EngineLine } from "@/lib/engine";
import { lineScore } from "@/lib/repetition";

/**
 * Força por rating. O Stockfish sempre calcula "de verdade"; a fraqueza vem de ESCOLHER entre as linhas dele
 * do jeito que um jogador daquele rating escolheria:
 *  - amostragem (softmax) sobre a chance de vitória de cada linha: rating baixo espalha a escolha por lances piores;
 *  - "vacilo": com uma probabilidade por lance, joga um lance claramente pior (peça pendurada, tática perdida).
 * Os números abaixo foram ajustados com `testes/forca-fit.mjs` (e conferidos em `testes/forca.test.mjs`) para
 * bater com a perda média por lance e a taxa de lances ruins de cada faixa de rating; as metas ficam no topo desses arquivos.
 */

export const MIN_RATING = 800;
export const MAX_RATING = 2600;

/** Nível 0–19 do controle de força do modo "contra o bot" ↔ rating (o 20 é força plena). */
export function ratingOfSkill(skill: number) {
  if (skill >= 20) return MAX_RATING;
  return Math.round(MIN_RATING + Math.max(0, Math.min(19, skill)) * 95);
}

type Anchor = {
  rating: number;
  /** Temperatura da amostragem, em pontos de chance de vitória. */
  temperature: number;
  /** Probabilidade de vacilo por lance. */
  lapse: number;
  /** Perda (pontos de chance de vitória) do lance de um vacilo: entre estes dois valores. */
  lapseMin: number;
  lapseMax: number;
  depth: number;
  movetime: number;
  multipv: number;
};

export const ANCHORS: Anchor[] = [
  { rating: 800, temperature: 26.9, lapse: 0.011, lapseMin: 12, lapseMax: 60, depth: 6, movetime: 350, multipv: 10 },
  { rating: 1000, temperature: 16.3, lapse: 0.02, lapseMin: 12, lapseMax: 55, depth: 6, movetime: 400, multipv: 10 },
  { rating: 1200, temperature: 10.6, lapse: 0.076, lapseMin: 10, lapseMax: 50, depth: 8, movetime: 500, multipv: 8 },
  { rating: 1400, temperature: 6.1, lapse: 0.13, lapseMin: 10, lapseMax: 45, depth: 8, movetime: 600, multipv: 8 },
  { rating: 1600, temperature: 4.3, lapse: 0.108, lapseMin: 9, lapseMax: 40, depth: 10, movetime: 800, multipv: 8 },
  { rating: 1800, temperature: 3.4, lapse: 0.088, lapseMin: 8, lapseMax: 35, depth: 10, movetime: 1000, multipv: 6 },
  { rating: 2000, temperature: 2.2, lapse: 0.091, lapseMin: 8, lapseMax: 30, depth: 12, movetime: 1400, multipv: 6 },
  { rating: 2200, temperature: 1.25, lapse: 0.124, lapseMin: 8, lapseMax: 25, depth: 13, movetime: 1800, multipv: 5 },
  { rating: 2400, temperature: 1.1, lapse: 0.05, lapseMin: 8, lapseMax: 25, depth: 14, movetime: 2200, multipv: 4 },
];

export function paramsFor(rating: number): Anchor {
  const r = Math.max(MIN_RATING, Math.min(2400, rating));
  let lower = ANCHORS[0];
  let upper = ANCHORS[ANCHORS.length - 1];
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    if (r >= ANCHORS[i].rating && r <= ANCHORS[i + 1].rating) {
      lower = ANCHORS[i];
      upper = ANCHORS[i + 1];
      break;
    }
  }
  const t = upper.rating === lower.rating ? 0 : (r - lower.rating) / (upper.rating - lower.rating);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    rating,
    temperature: mix(lower.temperature, upper.temperature),
    lapse: mix(lower.lapse, upper.lapse),
    lapseMin: mix(lower.lapseMin, upper.lapseMin),
    lapseMax: mix(lower.lapseMax, upper.lapseMax),
    depth: Math.round(mix(lower.depth, upper.depth)),
    movetime: Math.round(mix(lower.movetime, upper.movetime)),
    multipv: Math.round(mix(lower.multipv, upper.multipv)),
  };
}

/** Busca para um bot de rating abaixo de 2600: rasa e com várias linhas (é entre elas que ele escolhe). */
export function strengthBudget(rating: number, opts?: { pace?: number | null }) {
  const p = paramsFor(rating);
  const pace = opts?.pace;
  const factor = pace != null && pace <= 400 ? 0.8 : pace != null && pace >= 1500 ? 1.2 : 1;
  return { depth: p.depth, movetime: Math.max(250, Math.round(p.movetime * factor)), multipv: p.multipv };
}

export type WeakChoice = { uci: string; lapse: boolean; loss: number };

type Cand = { uci: string; win: number; loss: number; bias: number };

/**
 * Escolhe o lance de um bot com `rating` entre as linhas do motor (visão de quem joga).
 * `styleOf` (opcional) devolve o "gosto" do estilo por um lance; entra como um empurrão pequeno na amostragem,
 * então um bot agressivo de 1200 continua agressivo, só que sem a precisão de um motor.
 */
export function pickByRating(args: {
  lines: EngineLine[];
  rating: number;
  rng?: () => number;
  styleOf?: (uci: string) => number | null;
}): WeakChoice | null {
  const rng = args.rng ?? Math.random;
  const seen = new Set<string>();
  const raw: Array<{ uci: string; win: number }> = [];
  for (const line of args.lines) {
    const uci = line.pv.trim().split(/\s+/)[0] ?? "";
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || seen.has(uci)) continue;
    seen.add(uci);
    raw.push({ uci, win: cpToWinPercent(lineScore(line.scoreCp, line.mate)) });
  }
  if (raw.length === 0) return null;
  const topWin = Math.max(...raw.map((item) => item.win));
  const best = raw.reduce((a, b) => (b.win > a.win ? b : a));
  if (args.rating >= MAX_RATING || raw.length === 1) return { uci: best.uci, lapse: false, loss: 0 };

  const p = paramsFor(args.rating);
  let biases = new Map<string, number>();
  if (args.styleOf) {
    const values = raw.map((item) => ({ uci: item.uci, v: args.styleOf?.(item.uci) ?? 0 }));
    const mean = values.reduce((s, x) => s + x.v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, x) => s + (x.v - mean) ** 2, 0) / values.length) || 1;
    biases = new Map(values.map((x) => [x.uci, Math.max(-1.5, Math.min(1.5, (x.v - mean) / sd)) * 0.5]));
  }
  const cands: Cand[] = raw.map((item) => ({ uci: item.uci, win: item.win, loss: topWin - item.win, bias: biases.get(item.uci) ?? 0 }));

  // Vacilo: um lance claramente pior. Só vale se a posição ainda não está decidida (não adianta "vacilar" em 2%).
  if (rng() < p.lapse) {
    const pool = cands.filter((item) => item.loss >= p.lapseMin && item.loss <= p.lapseMax);
    if (pool.length > 0) {
      const pick = pool[Math.floor(rng() * pool.length)];
      return { uci: pick.uci, lapse: true, loss: pick.loss };
    }
  }

  const weights = cands.map((item) => Math.exp(-item.loss / p.temperature + item.bias));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < cands.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return { uci: cands[i].uci, lapse: false, loss: cands[i].loss };
  }
  const last = cands[cands.length - 1];
  return { uci: last.uci, lapse: false, loss: last.loss };
}
