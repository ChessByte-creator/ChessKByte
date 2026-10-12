export type Judgment =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export type WhiteEval = {
  cp: number;
  mate: number | null;
};

/** Ordem de exibição: do melhor para o pior, com "Livro" junto dos lances neutros. */
export const JUDGMENT_ORDER: Judgment[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export type JudgmentMeta = {
  label: string;
  plural: string;
  /** Símbolo curto, exibido no selo do tabuleiro e na lista de lances. */
  glyph: string;
  /** Cor de fundo do selo (estilo Chess.com). */
  color: string;
  /** Cor do texto sobre o papel claro (contraste suficiente). */
  ink: string;
};

export const JUDGMENT_META: Record<Judgment, JudgmentMeta> = {
  brilliant: { label: "Brilhante", plural: "Brilhantes", glyph: "!!", color: "#1baca6", ink: "#0d7a75" },
  great: { label: "Ótimo", plural: "Ótimos", glyph: "!", color: "#5c8bb0", ink: "#376a93" },
  best: { label: "Melhor", plural: "Melhores", glyph: "★", color: "#81b64c", ink: "#4d7a1f" },
  excellent: { label: "Excelente", plural: "Excelentes", glyph: "✓✓", color: "#96bc4b", ink: "#5f8222" },
  good: { label: "Bom", plural: "Bons", glyph: "✓", color: "#a3b18a", ink: "#68764f" },
  book: { label: "Livro", plural: "Livro", glyph: "📖", color: "#a88865", ink: "#7d5f3d" },
  inaccuracy: { label: "Imprecisão", plural: "Imprecisões", glyph: "?!", color: "#f0c15c", ink: "#9a6d00" },
  mistake: { label: "Erro", plural: "Erros", glyph: "?", color: "#e6912c", ink: "#a85a00" },
  miss: { label: "Lance perdido", plural: "Lances perdidos", glyph: "✕", color: "#dd5c5c", ink: "#b02f2f" },
  blunder: { label: "Erro grave", plural: "Erros graves", glyph: "??", color: "#c93430", ink: "#a3201c" },
};

export function judgmentInk(j: Judgment) {
  return JUDGMENT_META[j].ink;
}

export function isHarsh(j: Judgment) {
  return j === "inaccuracy" || j === "mistake" || j === "miss" || j === "blunder";
}

export type JudgmentCounts = Record<Judgment, number>;

export function emptyCounts(): JudgmentCounts {
  return {
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
  };
}

/** UCI score is from the side to move. Returns centipawns and mate distance from White's view. */
export function toWhiteEval(scoreCp: number | null, mate: number | null, turn: "w" | "b"): WhiteEval {
  const sign = turn === "w" ? 1 : -1;
  if (mate != null && mate !== 0) {
    const whiteMate = mate * sign;
    const cp = whiteMate > 0 ? 10000 - Math.abs(whiteMate) * 50 : -10000 + Math.abs(whiteMate) * 50;
    return { cp, mate: whiteMate };
  }
  return { cp: (scoreCp ?? 0) * sign, mate: null };
}

export function formatEval(ev: WhiteEval): string {
  if (ev.mate != null) {
    const n = Math.abs(ev.mate);
    return ev.mate > 0 ? `+M${n}` : `−M${n}`;
  }
  const pawns = Math.max(-99.9, Math.min(99.9, ev.cp / 100));
  const abs = Math.abs(pawns).toFixed(1);
  if (pawns >= 0.05) return `+${abs}`;
  if (pawns <= -0.05) return `−${abs}`;
  return "0.0";
}

export function evalBarPercent(ev: WhiteEval): number {
  const cp = ev.mate != null ? (ev.mate > 0 ? 1400 : -1400) : Math.max(-1400, Math.min(1400, ev.cp));
  const t = 1 / (1 + Math.exp(-cp / 280));
  return Math.round(Math.min(0.98, Math.max(0.02, t)) * 1000) / 10;
}

export function moverCp(ev: WhiteEval, color: "w" | "b") {
  return color === "w" ? ev.cp : -ev.cp;
}

/** Lichess win% model, clamped so mate-scale scores do not explode the curve. */
export function cpToWinPercent(cp: number) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/**
 * Curva de precisão por lance, no formato da Lichess mas mais rigorosa: a perda de chance de vitória
 * pesa 1,35x. Os dois win% são do lado de quem jogou.
 */
export const ACCURACY_STRICTNESS = 1.35;

export function moveAccuracy(winBefore: number, winAfter: number) {
  const diff = Math.max(0, winBefore - winAfter) * ACCURACY_STRICTNESS;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386709197 * diff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Precisão da partida: média entre a aritmética e a harmônica. A harmônica derruba a nota quando há
 * erros isolados (um erro grave não se dilui em muitos lances bons).
 */
export function gameAccuracy(values: number[]) {
  if (values.length === 0) return null;
  const arithmetic = values.reduce((sum, n) => sum + n, 0) / values.length;
  const harmonic = values.length / values.reduce((sum, n) => sum + 1 / Math.max(n, 1), 0);
  return (arithmetic + harmonic) / 2;
}

export type MoveClassInput = {
  /** Win% perdido pelo jogador que moveu (0–100). */
  winLoss: number;
  /** Win% do jogador antes do lance, com o melhor lance do motor. */
  winBefore: number;
  /** Win% do jogador depois do lance jogado. */
  winAfter: number;
  playedBest: boolean;
  forced: boolean;
  /** Número de lances legais na posição. */
  legalCount: number;
  /** Diferença de win% entre o melhor lance e a melhor alternativa. */
  gap: number;
  /** Lance ainda é teoria de abertura. */
  book: boolean;
  /** Sacrifício VOLUNTÁRIO: entregou material e existia alternativa que não perdia material. */
  sacrifice: boolean;
  /** Lance silencioso: sem captura, xeque ou promoção. */
  quiet: boolean;
  /** Um motor raso (profundidade 4) já acha esse lance: não é difícil de ver. */
  obvious: boolean;
  /** Quase sem escolha: poucos lances legais, ou em xeque com poucas saídas. */
  nearlyForced: boolean;
  /** Simples recaptura da peça que acabou de capturar. */
  recapture: boolean;
  /** Quanto o adversário perdeu de win% no lance anterior. */
  prevOpponentLoss: number;
  /** O melhor lance era mate forçado. */
  bestIsMate: boolean;
};

/** Limites calibrados para não inflar "Ótimo" e "Brilhante". */
export const GREAT_GAP = 15;
/** Quanto de chance de vitória o lance "melhor do motor" pode perder na checagem posterior e ainda ser "Melhor". */
export const BEST_TOLERANCE = 2;
export const BRILLIANT_MAX_BEFORE = 80;
export const BRILLIANT_MIN_AFTER = 50;
/** Brilhante por sacrifício: as alternativas têm de ser claramente piores. */
export const BRILLIANT_SAC_GAP = 10;
/** Brilhante sem sacrifício: todas as alternativas perdem pelo menos isto em chance de vitória. */
export const BRILLIANT_QUIET_GAP = 30;
export const BRILLIANT_QUIET_MIN_BEFORE = 15;

/**
 * Categorias por chance de vitória (pontos esperados), não por centipeões.
 * - Livro: lance de teoria.
 * - Brilhante: sacrifício voluntário de peça (nunca só peão), quase ótimo, e as outras linhas pioram de verdade.
 * - Ótimo: lance crítico que decide o jogo; a melhor alternativa é bem pior.
 */
export function classifyMove(input: MoveClassInput): Judgment {
  const { winLoss, winBefore, winAfter, playedBest, forced, legalCount, gap, book, sacrifice, quiet, obvious, nearlyForced, recapture, prevOpponentLoss, bestIsMate } = input;
  if (book) return "book";

  const nearBest = playedBest || winLoss < 3;
  const decided = winBefore >= 92 || winBefore <= 5;

  if (nearBest && !forced && !recapture) {
    // Brilhante: difícil de achar (um motor raso não acha) e não obrigatório, por um de dois caminhos:
    // 1) sacrifício voluntário de peça, com alternativas piores; 2) lance silencioso decisivo.
    const hard = !obvious && !nearlyForced && !bestIsMate && winAfter >= BRILLIANT_MIN_AFTER && winBefore <= BRILLIANT_MAX_BEFORE;
    if (hard && sacrifice && winLoss < 2.5 && gap >= BRILLIANT_SAC_GAP) return "brilliant";
    if (hard && quiet && playedBest && gap >= BRILLIANT_QUIET_GAP && winBefore >= BRILLIANT_QUIET_MIN_BEFORE) return "brilliant";
    if (playedBest && winLoss < BEST_TOLERANCE && legalCount > 2 && !decided && !bestIsMate && gap >= GREAT_GAP) return "great";
  }

  // "Melhor" exige que a avaliação medida depois do lance confirme: o motor raso pode escolher um lance que a busca seguinte desmente.
  if ((playedBest && winLoss < BEST_TOLERANCE) || winLoss < 0.5) return "best";
  if (winLoss < 5) return "excellent";
  if (winLoss < 10) return "good";

  // Deixou passar a chance criada por um erro do adversário, mas ainda ficou bem.
  if (prevOpponentLoss >= 10 && winAfter >= 35) return "miss";
  if (winLoss < 15) return "inaccuracy";
  if (winLoss < 25) return "mistake";
  return "blunder";
}

const NOTES: Record<Judgment, string[]> = {
  brilliant: [
    "Difícil de achar e o motor aprova. Brilhante.",
    "Não tinha nada de óbvio aqui, e você achou. Byte tirou o chapéu.",
    "Lance de quem enxerga além do que está na mesa. Brilhante.",
  ],
  great: [
    "Lance crítico: as outras opções pioravam bastante.",
    "Aqui a posição pedia precisão, e você encontrou.",
    "Era o lance que segurava (ou decidia) a partida.",
  ],
  best: ["É o lance do motor.", "Exatamente o que o Byte jogaria.", "Sem o que melhorar aqui."],
  excellent: ["Quase perfeito. Quase nada se perdeu.", "Excelente. Fica a um fio do melhor.", "Muito bom, o motor só preferia outro por detalhe."],
  good: ["Bom lance, a posição segue parecida.", "Joga, mas dava para ser mais preciso.", "Aceitável. Nada grave."],
  book: ["Teoria de abertura. Jogada conhecida.", "Lance de livro, todo mundo joga isso.", "Dentro da teoria."],
  inaccuracy: ["Imprecisão: a posição piorou um pouco.", "Hmm. Dava para fazer melhor.", "Um deslize pequeno, mas o motor notou."],
  mistake: ["Erro: abriu mão de uma boa parte da vantagem.", "Esse doeu. A avaliação caiu bastante.", "Erro. Vale rever essa posição."],
  miss: ["Deixou passar a chance que o adversário ofereceu.", "A oportunidade estava na mesa e passou batida.", "Lance perdido: havia algo muito melhor."],
  blunder: ["Erro grave: a avaliação despencou.", "Ai. Esse lance custa a partida.", "Erro grave. Byte não aguentou olhar."],
};

export function moveNote(judgment: Judgment, bestSan: string, playedBest: boolean, seed = 0): string {
  const options = NOTES[judgment];
  const base = options[Math.abs(seed) % options.length];
  const alt = bestSan && !playedBest ? ` Melhor era ${bestSan}.` : "";
  if (judgment === "brilliant" || judgment === "great" || judgment === "best" || judgment === "book") return base;
  return `${base}${alt}`;
}

export function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function formatPercent(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function levelName(skill: number) {
  if (skill <= 4) return "Iniciante";
  if (skill <= 9) return "Casual";
  if (skill <= 14) return "Clube";
  if (skill <= 17) return "Forte";
  return "Mestre";
}
