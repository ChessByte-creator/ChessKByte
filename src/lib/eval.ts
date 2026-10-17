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
  /** Chance de vitória perdida por quem jogou, em pontos (0–100): o "expected points lost" do Chess.com. */
  winLoss: number;
  /** Chance de vitória de quem joga antes do lance, com o melhor lance do motor. */
  winBefore: number;
  /** Chance de vitória de quem jogou depois do lance jogado. */
  winAfter: number;
  playedBest: boolean;
  forced: boolean;
  /** Número de lances legais na posição. */
  legalCount: number;
  /** Quase sem escolha: poucos lances legais, ou em xeque com poucas saídas. */
  nearlyForced: boolean;
  /** Simples recaptura da peça que acabou de capturar. */
  recapture: boolean;
  /** Lance de teoria de abertura. */
  book: boolean;
  /** Chance do melhor lance menos a da melhor alternativa (só faz sentido se o lance jogado foi o melhor). */
  gap: number;
  /** Chance de vitória da melhor alternativa ao lance jogado (null se o motor só deu uma linha). */
  secondWin: number | null;
  /** Sacrifício VOLUNTÁRIO: o lance deixou uma peça (não peão) em prise, perda líquida de 2+ pontos, e ela não estava assim antes. */
  sacrifice: boolean;
  /** Existe um lance sem sacrifício que o motor considera praticamente igual (a menos de 1,5 ponto de chance de vitória). */
  quietAltClose: boolean;
  /** Lance silencioso: sem captura, xeque ou promoção, e sem entregar material. */
  quiet: boolean;
  /** Um motor raso (profundidade 4) já escolhe esse lance: não é difícil de ver. */
  obvious: boolean;
  /** O lance só pegou uma peça que estava de graça. */
  freeCapture: boolean;
  /** Continuação de uma combinação que o motor já tinha previsto e que já foi premiada: não é um achado novo. */
  inChain: boolean;
  /** Quanto o adversário perdeu de chance no lance anterior. */
  prevOpponentLoss: number;
  /** O melhor lance era mate forçado. */
  bestIsMate: boolean;
  /** Número do lance na partida (1 = primeiro lance das brancas). */
  ply: number;
  /** Quem joga estava em xeque: responder ao xeque nunca é um achado brilhante. */
  inCheck: boolean;
  /** O lance dá xeque. */
  givesCheck: boolean;
};

/**
 * Limites de perda de chance de vitória (pontos esperados), os mesmos degraus do Chess.com:
 * Excelente até 2, Bom até 5, Imprecisão até 10, Erro até 20, acima disso Erro grave.
 */
export const EXCELLENT_MAX = 2;
export const GOOD_MAX = 5;
export const INACCURACY_MAX = 10;
export const MISTAKE_MAX = 20;
/** Lance de teoria que perde isto ou mais deixa de ser "livro" (o Chess.com marca imprecisão no 8...Nxc3 do Møller). */
export const BOOK_MAX_LOSS = 5.5;
/** Nos primeiros lances (teoria de linha principal, como o 2.f4 do Gambito do Rei) a tolerância é maior. */
export const BOOK_EARLY_PLIES = 10;
export const BOOK_EARLY_LOSS = 8;
/** Perto do equilíbrio o Chess.com é mais rígido: a mesma perda de chance pesa mais. Fator até 1 + EQ_BOOST em 50%. */
export const EQ_BOOST = 0.4;
export const EQ_WIDTH = 20;
export function equalityFactor(winBefore: number) {
  return 1 + EQ_BOOST * Math.max(0, 1 - Math.abs(winBefore - 50) / EQ_WIDTH);
}
/** Erro do adversário (perda bruta) a partir do qual deixar de aproveitar vira "lance perdido". */
export const MISS_PREV_MIN = 6;
/** Quanto o melhor lance pode perder na checagem posterior e ainda ser "Melhor". */
export const BEST_TOLERANCE = 2;

/** Ótimo: a melhor alternativa tem que ser pior por pelo menos isto. */
export const GREAT_GAP = 12;
/** ...ou por isto, mesmo sem mudar de faixa de avaliação. */
export const GREAT_BIG_GAP = 25;
/** Acima disto, o lance vale como Ótimo mesmo que um motor raso o ache (as alternativas perdem muito). */
export const GREAT_OBVIOUS_GAP = 35;
/** Brilhante: ainda não pode estar ganhando de lavada antes, nem perdendo depois. */
export const BRILLIANT_MAX_BEFORE = 92;
export const BRILLIANT_MIN_AFTER = 45;
export const BRILLIANT_MAX_LOSS = 2.5;
/** Só descarta o sacrifício por haver alternativa tranquila quando quem joga já está melhor que isto. */
export const QUIET_ALT_MIN_WIN = 55;
/** Acima disto a posição já está esmagadora: um sacrifício que a mantém ainda vale (o Chess.com dá, ex.: Rb8+ com +5,7). */
export const QUIET_ALT_MAX_WIN = 80;

/** Faixa de avaliação de quem joga: 3 ganhando, 2 melhor, 1 igual, 0 pior, -1 perdendo. */
export function zone(win: number) {
  if (win >= 75) return 3;
  if (win >= 58) return 2;
  if (win >= 42) return 1;
  if (win >= 25) return 0;
  return -1;
}

/**
 * Categorias por chance de vitória, no estilo do Chess.com:
 * - Livro: lance de teoria.
 * - Brilhante: bom lance (quase o melhor) que SACRIFICA uma peça de forma voluntária e não óbvia, sem estar
 *   já ganhando de lavada e sem ficar perdendo. Um achado novo: continuação de uma combinação já premiada não conta.
 *   Também vale o lance silencioso que sozinho transforma uma posição não ganha em ganha.
 * - Ótimo: o melhor lance, quando a melhor alternativa é bem pior (cai de faixa de avaliação); ficam de fora
 *   lances forçados, recapturas, peça de graça, mate e continuações de uma combinação.
 */
export function classifyMove(i: MoveClassInput): Judgment {
  if (i.book && i.winLoss < (i.ply <= BOOK_EARLY_PLIES ? BOOK_EARLY_LOSS : BOOK_MAX_LOSS)) return "book";

  const free = !i.forced && !i.nearlyForced && !i.recapture;
  const nearBest = i.playedBest || i.winLoss < 1.5;

  // Um sacrifício pode custar até BRILLIANT_MAX_LOSS e ainda ser o lance do achado (o Rb8+ do exemplo perde 1,6).
  const nearBestForBrilliant = i.playedBest || i.winLoss < BRILLIANT_MAX_LOSS;
  if (nearBestForBrilliant && free && !i.freeCapture) {
    // Brilhante: sacrifício voluntário, que não é resposta a xeque, que não perde chance e que não acontece
    // com a partida já decidida. Combinações seguidas podem ter vários brilhantes (o Chess.com também dá),
    // porque cada lance só conta se ele mesmo entrega material (ver `newSacrifice`).
    // Se já está melhor, um lance sem sacrifício quase igual dispensa o sacrifício; em posição igual/pior, não.
    const quietAltMatters = i.quietAltClose && i.winBefore >= QUIET_ALT_MIN_WIN && i.winBefore < QUIET_ALT_MAX_WIN;
    if (i.sacrifice && !i.inCheck && i.winLoss < BRILLIANT_MAX_LOSS && i.winBefore <= BRILLIANT_MAX_BEFORE && i.winAfter >= BRILLIANT_MIN_AFTER && !quietAltMatters) {
      return "brilliant";
    }
    const hiddenWin = i.quiet && i.playedBest && !i.obvious && !i.inChain && !i.bestIsMate && i.gap >= 30 && i.winBefore <= 65 && i.winAfter >= 70;
    if (hiddenWin) return "brilliant";
  }

  if (nearBest && !i.freeCapture) {
    // Ótimo (!): lance crítico. Xeques e sequências forçadas contam (o Chess.com premia cada "único lance"),
    // mas um lance que um motor raso já acha só vale se for xeque ou se a diferença for enorme.
    const critical = i.secondWin !== null && i.gap >= GREAT_GAP && (zone(i.winBefore) - zone(i.secondWin) >= 1 || i.gap >= GREAT_BIG_GAP);
    // Quando as alternativas perdem MUITO (gap grande), o lance é o único que segura, mesmo que um motor raso o ache:
    // o Chess.com premia (a dama que escapa do único jeito, o xeque que só ele salva).
    // Segurar a vitória: estava ganhando (≥60%) e todas as outras opções jogam isso fora (<60%).
    const keepsTheWin = i.secondWin !== null && i.winBefore >= 60 && i.secondWin < 60 && i.gap >= 15;
    const hardToSee = !i.obvious || i.givesCheck || i.gap >= GREAT_OBVIOUS_GAP || keepsTheWin;
    // Fugir de um xeque com 3+ lances legais, sendo o único que segura (Ke2 em vez de Kf1), também é achado.
    const freeForGreat = !i.forced && !i.recapture && (!i.nearlyForced || (i.legalCount >= 3 && i.gap >= 20));
    if (freeForGreat && i.playedBest && i.winLoss < 1.5 && critical && hardToSee && !i.bestIsMate && i.winBefore > 8 && i.winBefore < 90) return "great";
  }

  // "Melhor" exige que a avaliação medida depois do lance confirme: o motor raso pode escolher um lance que a busca seguinte desmente.
  if ((i.playedBest && i.winLoss < BEST_TOLERANCE) || i.winLoss < 0.5) return "best";
  const loss = i.winLoss * equalityFactor(i.winBefore);
  if (loss < EXCELLENT_MAX) return "excellent";
  if (loss < GOOD_MAX) return "good";
  // Deixou passar a chance criada por um erro do adversário (mesmo que ainda fique bem ou que a perda seja grande).
  if (i.prevOpponentLoss >= MISS_PREV_MIN && loss < 25) return "miss";
  if (loss < INACCURACY_MAX) return "inaccuracy";
  if (loss < MISTAKE_MAX) return "mistake";
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
