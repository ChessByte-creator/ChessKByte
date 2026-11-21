import { cpToWinPercent } from "@/lib/eval";
import type { EngineLine } from "@/lib/engine";
import { lineScore } from "@/lib/repetition";
import { newSacrifice } from "@/lib/tactics";

/**
 * Força por rating, em escala MEDIDA: o rating de cada nível é o Elo que o bot tem contra o Stockfish limitado por
 * UCI_Elo (a escala que o próprio Stockfish usa; ver testes/forca-medir.mjs, que joga as partidas).
 *
 * O Stockfish calcula "de verdade", mas raso (profundidade pequena, como quem não enxerga longe) e com várias linhas.
 * A fraqueza vem de DUAS coisas que parecem erro humano, não de sorteio:
 *  - horizonte: quanto menor o rating, menos lances à frente o bot vê (profundidade);
 *  - escolha: entre as linhas dele, o bot sorteia com preferência pelas melhores (softmax sobre a chance de vitória);
 *  - distração: nos níveis baixos, com certa probabilidade ele NÃO percebe que um lance deixa uma peça pendurada.
 *    Acima disso ele evita lance que entrega peça de graça, como qualquer jogador do rating.
 */

export const MIN_RATING = 400;
/** Último nível "humano". Acima disso o app usa o Stockfish pleno (Máximo). */
export const MAX_RATING = 2600;
/** Valor que representa o "Máximo" (Stockfish pleno) nos controles de rating. */
export const FULL_RATING = 2700;

export const LEVELS = [
  { rating: 400, name: "Iniciante" },
  { rating: 1200, name: "Intermediário" },
  { rating: 2000, name: "Avançado" },
  { rating: 2600, name: "Mestre" },
] as const;

/** Nome da faixa do rating (meio-termos ganham o nome da faixa mais próxima de baixo). */
export function ratingBand(rating: number): string {
  if (rating > MAX_RATING) return "Máximo";
  let name: string = LEVELS[0].name;
  for (const level of LEVELS) if (rating >= level.rating - 1e-9) name = level.name;
  return name;
}

/** Nível 0–20 do controle antigo ↔ rating (o 20 é força plena). Só serve para salvamentos antigos. */
export function ratingOfSkill(skill: number) {
  if (skill >= 20) return FULL_RATING;
  const raw = MIN_RATING + (Math.max(0, Math.min(19, skill)) / 19) * (MAX_RATING - MIN_RATING);
  return Math.round(raw / 50) * 50;
}

/** Rating ↔ nível 0–20 que o resto do app (estilo, orçamento de pensamento) ainda usa. */
export function skillOfRating(rating: number) {
  if (rating > MAX_RATING) return 20;
  return Math.max(0, Math.min(19, Math.round(((rating - MIN_RATING) / (MAX_RATING - MIN_RATING)) * 19)));
}

/** Como um bot desse rating joga, em uma frase. */
export function ratingBlurb(rating: number): string {
  if (rating > MAX_RATING) return "Stockfish pleno: joga o melhor lance que encontra, sem erros de propósito.";
  if (rating < 800) return "Esquece peças penduradas, não vê ameaças e deixa passar mate em 1.";
  if (rating < 1200) return "Vê capturas diretas, mas cai em táticas simples e entrega peça com frequência.";
  if (rating < 1600) return "Joga com lógica, mas ainda perde material em táticas de dois ou três lances.";
  if (rating < 2000) return "Poucos erros graves. Mantém o plano e só falha em táticas mais profundas.";
  if (rating < 2600) return "Cálculo firme e boa técnica. Os erros são pequenos e raros.";
  return "Nível de mestre: pune qualquer imprecisão e converte posições melhores.";
}

type Anchor = {
  rating: number;
  /** Temperatura da amostragem, em pontos de chance de vitória. */
  temperature: number;
  /** Probabilidade de NÃO perceber que o lance entrega uma peça (peça pendurada). */
  blind: number;
  /** Mantido por compatibilidade: vacilo aleatório (hoje 0 em todos os níveis). */
  lapse: number;
  lapseMin: number;
  lapseMax: number;
  depth: number;
  movetime: number;
  multipv: number;
};

// Do 1600 para cima a busca é mais funda (menos erro tático de "blitz"); a graça humana fica na temperatura.
// ATENÇÃO: essa profundidade NÃO foi recalibrada por partidas: o bot tende a ficar mais forte que o rating do nome.
export const ANCHORS: Anchor[] = [
  // 400 e 800 ainda são estimativas (não medidas por partidas). Os demais foram calibrados contra o Stockfish com UCI_Elo.
  { rating: 400, temperature: 40, blind: 0.6, lapse: 0, lapseMin: 12, lapseMax: 55, depth: 1, movetime: 300, multipv: 12 },
  { rating: 800, temperature: 24, blind: 0.35, lapse: 0, lapseMin: 12, lapseMax: 55, depth: 2, movetime: 300, multipv: 10 },
  { rating: 1200, temperature: 8.5, blind: 0.12, lapse: 0, lapseMin: 10, lapseMax: 50, depth: 4, movetime: 400, multipv: 8 },
  { rating: 1600, temperature: 5, blind: 0.04, lapse: 0, lapseMin: 10, lapseMax: 45, depth: 6, movetime: 1000, multipv: 6 },
  { rating: 2000, temperature: 3.5, blind: 0, lapse: 0, lapseMin: 8, lapseMax: 30, depth: 8, movetime: 1600, multipv: 5 },
  { rating: 2400, temperature: 2.1, blind: 0, lapse: 0, lapseMin: 8, lapseMax: 25, depth: 11, movetime: 2600, multipv: 4 },
  { rating: 2600, temperature: 4.2, blind: 0, lapse: 0, lapseMin: 8, lapseMax: 25, depth: 14, movetime: 3600, multipv: 3 },
];

export function paramsFor(rating: number): Anchor {
  const r = Math.max(MIN_RATING, Math.min(MAX_RATING, rating));
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
  // A temperatura varia por razão (geométrica): 10 pontos a menos importam mais perto de 0 do que perto de 40.
  const geo = (a: number, b: number) => (a > 0 && b > 0 ? a * Math.pow(b / a, t) : mix(a, b));
  return {
    rating,
    temperature: geo(lower.temperature, upper.temperature),
    blind: mix(lower.blind, upper.blind),
    lapse: mix(lower.lapse, upper.lapse),
    lapseMin: mix(lower.lapseMin, upper.lapseMin),
    lapseMax: mix(lower.lapseMax, upper.lapseMax),
    depth: Math.max(1, Math.round(mix(lower.depth, upper.depth))),
    movetime: Math.round(mix(lower.movetime, upper.movetime)),
    multipv: Math.max(2, Math.round(mix(lower.multipv, upper.multipv))),
  };
}

/** Busca para um bot abaixo do Máximo: rasa e com várias linhas (é entre elas que ele escolhe). */
export function strengthBudget(rating: number, opts?: { pace?: number | null }) {
  const p = paramsFor(rating);
  const pace = opts?.pace;
  const factor = pace != null && pace <= 400 ? 0.8 : pace != null && pace >= 1500 ? 1.2 : 1;
  return { depth: p.depth, movetime: Math.max(250, Math.round(p.movetime * factor)), multipv: p.multipv };
}

export type WeakChoice = { uci: string; lapse: boolean; loss: number };

type Cand = { uci: string; win: number; loss: number; bias: number; hangs: boolean };

/**
 * Escolhe o lance de um bot com `rating` entre as linhas do motor (visão de quem joga).
 * `styleOf` (opcional) devolve o "gosto" do estilo por um lance; entra como um empurrão pequeno na amostragem,
 * então um bot agressivo de 1200 continua agressivo, só que sem a precisão de um motor.
 * `fen` (opcional) é a posição antes do lance: com ele o bot deixa de entregar peça de graça, exceto quando "não vê".
 */
export function pickByRating(args: {
  lines: EngineLine[];
  rating: number;
  fen?: string;
  rng?: () => number;
  styleOf?: (uci: string) => number | null;
  /** Força do estilo na amostragem (padrão 0,5). Perfis como o Kamikaze usam mais. */
  styleGain?: number;
  /** Perfil de sacrifício: não descarta como "peça pendurada" o lance que o estilo quer. */
  keepSacrifices?: boolean;
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
  if (args.rating > MAX_RATING || raw.length === 1) return { uci: best.uci, lapse: false, loss: 0 };

  const p = paramsFor(args.rating);
  let biases = new Map<string, number>();
  if (args.styleOf) {
    const values = raw.map((item) => ({ uci: item.uci, v: args.styleOf?.(item.uci) ?? 0 }));
    const mean = values.reduce((s, x) => s + x.v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, x) => s + (x.v - mean) ** 2, 0) / values.length) || 1;
    biases = new Map(values.map((x) => [x.uci, Math.max(-1.5, Math.min(1.5, (x.v - mean) / sd)) * Math.min(0.8, args.styleGain ?? 0.5)]));
  }
  // O estilo só desempata entre lances de qualidade parecida: nunca promove um lance muito pior que o melhor.
  const slack = p.temperature + 2;
  let cands: Cand[] = raw.map((item) => ({
    uci: item.uci,
    win: item.win,
    loss: topWin - item.win,
    bias: topWin - item.win <= slack ? (biases.get(item.uci) ?? 0) : Math.min(0, biases.get(item.uci) ?? 0),
    hangs: args.fen && item.win < topWin - 0.5 ? newSacrifice(args.fen, item.uci) !== null : false,
  }));

  // Distração: só com probabilidade `blind` o bot "não vê" que o lance entrega uma peça. No resto das vezes ele
  // descarta esses lances (se sobrar algum outro), como um jogador do rating faria.
  if (args.fen && rng() >= p.blind) {
    const safe = cands.filter((item) => !item.hangs || (args.keepSacrifices === true && item.bias >= 0.5 && item.loss <= 3));
    if (safe.length > 0) cands = safe;
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
