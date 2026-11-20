import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

type ScoredLine = {
  scoreCp: number | null;
  mate: number | null;
  pv: string;
  depth?: number;
};

export type PersonalityId =
  | "balanced"
  | "aggressive"
  | "positional"
  | "tactical"
  | "solid"
  | "materialist"
  | "speculative"
  | "simplifier"
  | "kamikaze"
  | "custom";

type Axis =
  | "check"
  | "kingAttack"
  | "storm"
  | "center"
  | "develop"
  | "castle"
  | "structure"
  | "capture"
  | "tension"
  | "bind"
  | "sacrifice"
  | "material"
  | "trade"
  | "simplify"
  | "safety"
  | "quiet"
  | "restraint"
  | "attackSac"
  | "gambit";

type Weights = Record<Axis, number>;
type Features = Record<Axis, number>;

export type Personality = {
  id: PersonalityId;
  name: string;
  blurb: string;
  /** Centipawn slack at mid strength. High skill tightens this; low skill widens it. */
  windowCp: number;
  weights: Weights;
  /** Peso da avaliação do motor na escolha (1 = padrão). Baixo = aceita perder avaliação por estilo. */
  care?: number;
  /** Força do estilo quando o bot joga por rating (strength.ts). */
  gain?: number;
  /** Sacrifício máximo que o perfil aceita: lances acima disso saem da lista. */
  sacCap?: number;
  /** Havendo sacrifício de ataque dentro da janela, o perfil joga um deles. */
  forceAttackSac?: boolean;
  /** Avaliação absoluta mínima (cp) que o perfil aceita criar por estilo. */
  floorCp?: number;
};

const ZERO_W: Weights = {
  check: 0,
  kingAttack: 0,
  storm: 0,
  center: 0,
  develop: 0,
  castle: 0,
  structure: 0,
  capture: 0,
  tension: 0,
  bind: 0,
  sacrifice: 0,
  material: 0,
  trade: 0,
  simplify: 0,
  safety: 0,
  quiet: 0,
  restraint: 0,
  attackSac: 0,
  gambit: 0,
};

function w(partial: Partial<Weights>): Weights {
  return { ...ZERO_W, ...partial };
}

/** Perfil editável: o que o usuário mistura nos controles (ver setCustomMix). Mutado no lugar. */
const CUSTOM: Personality = { id: "custom", name: "Personalizado", blurb: "", windowCp: 0, weights: w({}) };

export const PERSONALITIES: Personality[] = [
  {
    id: "balanced",
    name: "Equilibrado",
    blurb: "Joga o lance mais forte do Stockfish, sem preferência de estilo.",
    windowCp: 0,
    weights: w({}),
  },
  {
    id: "aggressive",
    name: "Agressivo",
    blurb: "Ataca o rei, abre linhas e aceita risco para ficar com a iniciativa. Sacrifica quando o ataque compensa.",
    windowCp: 130,
    care: 0.8,
    gain: 1,
    floorCp: -150,
    weights: w({
      check: 3,
      kingAttack: 3.4,
      storm: 2.6,
      attackSac: 2.2,
      sacrifice: 0.8,
      tension: 0.8,
      develop: 0.4,
      safety: -0.6,
      quiet: -1,
      simplify: -1.6,
      trade: -0.8,
    }),
  },
  {
    id: "kamikaze",
    name: "Kamikaze",
    blurb: "Sacrifica material em quase todo ataque. Quer o rei do adversário, não a vantagem.",
    windowCp: 260,
    care: 0.35,
    gain: 1.6,
    floorCp: -260,
    forceAttackSac: true,
    weights: w({
      attackSac: 5,
      sacrifice: 2.2,
      check: 3.4,
      kingAttack: 3.8,
      storm: 2.6,
      tension: 1,
      material: -1.4,
      safety: -1.4,
      quiet: -1.6,
      simplify: -2.4,
      trade: -1.6,
    }),
  },
  {
    id: "positional",
    name: "Posicional",
    blurb: "Melhora peças, peões e o centro. Evita ataque prematuro e dama solta.",
    windowCp: 70,
    gain: 0.8,
    sacCap: 0.9,
    weights: w({
      center: 2.6,
      structure: 3.2,
      develop: 2.2,
      castle: 1.2,
      bind: 2.4,
      restraint: 2.2,
      quiet: 1.1,
      safety: 0.5,
      check: -0.4,
      sacrifice: -2.4,
      attackSac: -2,
      gambit: -1.5,
      capture: -0.2,
    }),
  },
  {
    id: "tactical",
    name: "Tático",
    blurb: "Procura capturas, cravadas e posições com várias ameaças ao mesmo tempo.",
    windowCp: 100,
    gain: 0.9,
    weights: w({
      check: 2,
      capture: 1.8,
      tension: 3,
      bind: 2.6,
      kingAttack: 0.9,
      quiet: -1.8,
      simplify: -1.6,
      trade: -0.4,
    }),
  },
  {
    id: "solid",
    name: "Sólido",
    blurb: "Cuida do rei, evita sacrifício e só entra no que está bem defendido.",
    windowCp: 55,
    gain: 0.9,
    sacCap: 0.5,
    weights: w({
      safety: 3.6,
      castle: 2.4,
      structure: 1.8,
      develop: 1.4,
      restraint: 1.8,
      quiet: 0.8,
      sacrifice: -3.2,
      attackSac: -2.5,
      gambit: -2,
      check: -0.5,
      storm: -1.2,
    }),
  },
  {
    id: "materialist",
    name: "Materialista",
    blurb: "Prefere a peça a mais e desconfia de compensação e de gambito.",
    windowCp: 80,
    gain: 0.9,
    sacCap: 0.4,
    weights: w({
      material: 4.2,
      capture: 1.6,
      trade: -0.2,
      sacrifice: -3.4,
      attackSac: -2.5,
      gambit: -2.5,
      safety: 0.6,
      storm: -0.4,
    }),
  },
  {
    id: "speculative",
    name: "Especulativo",
    blurb: "Oferece gambitos: entrega peão por desenvolvimento, centro e linhas abertas.",
    windowCp: 140,
    care: 0.7,
    gain: 1.1,
    weights: w({
      gambit: 3.6,
      sacrifice: 1.8,
      attackSac: 1,
      storm: 1.6,
      kingAttack: 1.6,
      develop: 1.8,
      center: 1,
      check: 0.8,
      material: -1.2,
      quiet: -0.6,
      simplify: -1.2,
    }),
  },
  {
    id: "simplifier",
    name: "Simplificador",
    blurb: "Troca peças, reduz o perigo e conduz o jogo para um final mais fácil.",
    windowCp: 75,
    gain: 0.9,
    sacCap: 0.6,
    weights: w({
      trade: 3.2,
      simplify: 3.4,
      material: 1.2,
      safety: 1.1,
      castle: 0.6,
      sacrifice: -2.2,
      attackSac: -2,
      gambit: -2,
      storm: -0.6,
      check: -0.3,
    }),
  },
  CUSTOM,
];

const BY_ID = Object.fromEntries(PERSONALITIES.map((item) => [item.id, item])) as Record<PersonalityId, Personality>;

export function personalityById(id: string | null | undefined): Personality {
  if (id && id in BY_ID) return BY_ID[id as PersonalityId];
  return BY_ID.balanced;
}

// ---------------------------------------------------------------------------------------------------------
// Mistura de personalidades: "Personalizado" = média ponderada dos perfis (cada um de 0 a 100%) × intensidade.
// "Equilibrado" na mistura funciona como diluente: quanto mais, mais perto do Stockfish puro.
// ---------------------------------------------------------------------------------------------------------

export type MixId = Exclude<PersonalityId, "custom">;
export type StyleMix = { shares: Partial<Record<MixId, number>>; intensity: number };

export const MIX_IDS: MixId[] = ["balanced", "aggressive", "kamikaze", "tactical", "speculative", "positional", "solid", "materialist", "simplifier"];
export const DEFAULT_MIX: StyleMix = { shares: { balanced: 30, aggressive: 70 }, intensity: 100 };

const AXES = Object.keys(ZERO_W) as Axis[];
const MIX_KEY = "byte.styleMix";
let customMix: StyleMix = DEFAULT_MIX;

function blend(mix: StyleMix): Omit<Personality, "id" | "name"> {
  const parts = MIX_IDS.map((id) => ({ item: BY_ID[id], share: clamp(mix.shares[id] ?? 0, 0, 100) })).filter((part) => part.share > 0);
  const total = parts.reduce((sum, part) => sum + part.share, 0);
  const k = clamp(mix.intensity, 0, 150) / 100;
  if (total <= 0 || k === 0) {
    return { blurb: "Sem estilo: joga como o Stockfish.", windowCp: 0, weights: w({}) };
  }
  const weights = w({});
  let windowCp = 0;
  let care = 0;
  let gain = 0;
  let cap = 0;
  let floor = 0;
  let force = 0;
  for (const { item, share } of parts) {
    const f = share / total;
    for (const axis of AXES) weights[axis] += item.weights[axis] * f * k;
    windowCp += item.windowCp * f;
    care += (item.care ?? 1) * f;
    gain += (item.gain ?? 0.5) * f;
    cap += (item.sacCap ?? 3.5) * f;
    floor += (item.floorCp ?? -600) * f;
    if (item.forceAttackSac) force += f;
  }
  const top = parts
    .slice()
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map(({ item, share }) => `${Math.round((share / total) * 100)}% ${item.name}`);
  return {
    blurb: `Mistura: ${top.join(" + ")}.`,
    windowCp: Math.round(windowCp * Math.max(0.6, k)),
    weights,
    care,
    gain: clamp(gain * k, 0.3, 2),
    sacCap: cap >= 3 ? undefined : cap,
    floorCp: floor <= -550 ? undefined : Math.round(floor),
    forceAttackSac: force >= 0.5,
  };
}

export function getCustomMix(): StyleMix {
  return customMix;
}

/** Define a mistura do perfil "Personalizado" (e guarda no navegador). */
export function setCustomMix(mix: StyleMix, persist = true) {
  customMix = { shares: { ...mix.shares }, intensity: mix.intensity };
  Object.assign(CUSTOM, blend(customMix));
  if (!persist || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MIX_KEY, JSON.stringify(customMix));
  } catch {
    /* sem armazenamento: a mistura vale só nesta sessão */
  }
}

/** Resumo do perfil em 6 eixos de -1 (evita) a +1 (busca), para os gráficos. */
export function traitProfile(personality: Personality): Array<{ id: string; label: string; value: number }> {
  const sum = (axes: Axis[]) => axes.reduce((total, axis) => total + personality.weights[axis], 0);
  const groups: Array<[string, string, Axis[], number]> = [
    ["attack", "Ataque ao rei", ["check", "kingAttack", "storm"], 10],
    ["sacrifice", "Sacrifício", ["sacrifice", "attackSac", "gambit"], 10],
    ["position", "Posição", ["center", "structure", "develop", "bind"], 8],
    ["safety", "Segurança", ["safety", "castle", "restraint"], 6],
    ["material", "Material", ["material", "capture"], 6],
    ["simplify", "Trocas", ["trade", "simplify"], 6],
  ];
  return groups.map(([id, label, axes, scale]) => ({ id, label, value: clamp(sum(axes) / scale, -1, 1) }));
}

function loadStoredMix() {
  setCustomMix(DEFAULT_MIX, false);
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(MIX_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<StyleMix>;
    if (saved && typeof saved === "object" && saved.shares && typeof saved.intensity === "number") {
      setCustomMix({ shares: saved.shares, intensity: saved.intensity }, false);
    }
  } catch {
    /* ignora dado corrompido */
  }
}

loadStoredMix();

const AXIS_REASON: Record<Axis, string> = {
  check: "busca o xeque",
  kingAttack: "ataca o rei",
  storm: "avança contra o rei",
  center: "disputa o centro",
  develop: "desenvolve as peças",
  castle: "quer rocar",
  structure: "cuida dos peões",
  capture: "entra na captura",
  tension: "cria ameaças",
  bind: "prende uma peça",
  sacrifice: "sacrifica material",
  material: "fica com mais material",
  trade: "força a troca",
  simplify: "simplifica",
  safety: "joga mais seguro",
  quiet: "melhora sem forçar",
  restraint: "segura a dama",
  attackSac: "sacrifica para atacar o rei",
  gambit: "oferece um gambito",
};

const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 0 };

const CENTER: Record<string, number> = {
  d4: 1,
  e4: 1,
  d5: 1,
  e5: 1,
  c4: 0.62,
  f4: 0.48,
  c5: 0.62,
  f5: 0.48,
  d3: 0.28,
  e3: 0.28,
  d6: 0.28,
  e6: 0.28,
};

type Occupant = { color: Color; type: PieceSymbol };

export type StyleChoice = {
  uci: string;
  san: string;
  bestUci: string;
  bestSan: string;
  diverged: boolean;
  note: string;
};

export function styleWindow(personality: Personality, skill: number): number {
  if (personality.windowCp <= 0) return 0;
  const clamped = Math.max(0, Math.min(20, skill));
  const factor = 0.55 + ((20 - clamped) / 20) * 0.9;
  return Math.round(personality.windowCp * factor);
}

function scoresAreNoise(depth: number | undefined, skill: number) {
  if (depth == null) return false;
  const floor = skill >= 16 ? 10 : skill >= 8 ? 7 : 5;
  return depth < floor;
}

export function pickStyledMove(args: {
  fen: string;
  lines: ScoredLine[];
  bestmove: string;
  personalityId: PersonalityId;
  skill: number;
  /** Search depth behind the scores. Shallow lines are noise, not a style. */
  depth?: number;
}): StyleChoice {
  const personality = personalityById(args.personalityId);
  const pool = candidatePool(args.fen, args.lines, args.bestmove);
  const emptySan = "…";
  if (pool.length === 0) {
    return { uci: args.bestmove, san: emptySan, bestUci: args.bestmove, bestSan: emptySan, diverged: false, note: "" };
  }
  const deepest = pool.reduce((max, item) => Math.max(max, item.depth ?? 0), 0);
  const trusted = deepest > 0 ? pool.filter((item) => (item.depth ?? 0) >= deepest - 1) : pool;
  const objective = trusted.reduce((best, item) => (item.score > best.score ? item : best));
  if (personality.id === "balanced" || scoresAreNoise(args.depth, args.skill)) {
    return {
      uci: objective.uci,
      san: objective.san,
      bestUci: objective.uci,
      bestSan: objective.san,
      diverged: false,
      note: "",
    };
  }

  const mates = trusted.filter((item) => item.mate != null && item.mate > 0);
  const takingMate = mates.length > 0 && (objective.mate ?? 0) > 0;
  let candidates = trusted;
  if (takingMate) {
    const shortest = Math.min(...mates.map((item) => item.mate ?? 99));
    candidates = mates.filter((item) => (item.mate ?? 99) <= shortest + 1);
  } else {
    // Perfis de sacrifício ganham folga extra quando já estão pior: nada a perder.
    const sacrificial = personality.weights.attackSac + personality.weights.sacrifice > 2.5;
    const stretch = sacrificial && objective.score < -80 ? 1.3 : 1;
    const window = Math.round(styleWindow(personality, args.skill) * stretch);
    const floor = personality.floorCp != null ? Math.min(personality.floorCp, objective.score) : -Infinity;
    candidates = pool.filter((item) => objective.score - item.score <= window && item.score >= floor);
  }
  if (candidates.length === 0) candidates = [objective];

  const raws = new Map<string, Features>();
  for (const item of candidates) raws.set(item.uci, lineFeatures(args.fen, item.pv));
  if (!takingMate) {
    // Fidelidade: o que o perfil recusa nunca entra; o que ele ama tem prioridade.
    if (personality.sacCap != null) {
      const cap = personality.sacCap;
      const kept = candidates.filter((item) => (raws.get(item.uci)?.sacrifice ?? 0) <= cap);
      if (kept.length > 0) candidates = kept;
    }
    if (personality.forceAttackSac) {
      const attacking = candidates.filter((item) => (raws.get(item.uci)?.attackSac ?? 0) >= 1.2);
      if (attacking.length > 0) candidates = attacking;
    }
  }

  let chosen = objective;
  let bestTotal = -Infinity;
  const scored = new Map<string, { total: number; weighted: Features }>();
  for (const item of candidates) {
    const weighted = applyWeights(raws.get(item.uci) ?? zeroFeatures(), personality.weights);
    const jitter = (hashText(`${args.fen}|${item.uci}`) - 0.5) * 0.18;
    const evalNudge = ((item.score - objective.score) / 32) * (personality.care ?? 1);
    const total = sumFeatures(weighted) + jitter + evalNudge;
    scored.set(item.uci, { total, weighted });
    if (total > bestTotal) {
      bestTotal = total;
      chosen = item;
    }
  }
  const objectiveWeighted = applyWeights(raws.get(objective.uci) ?? lineFeatures(args.fen, objective.pv), personality.weights);

  const diverged = chosen.uci !== objective.uci;
  const reason = diverged ? reasonFor(scored.get(chosen.uci)?.weighted, objectiveWeighted) : "";
  const note = diverged ? `${personality.name} escolheu ${chosen.san} em vez de ${objective.san}: ${reason}.` : "";
  return {
    uci: chosen.uci,
    san: chosen.san,
    bestUci: objective.uci,
    bestSan: objective.san,
    diverged,
    note,
  };
}

/** Raw style score of one legal move, before the eval tie-break. Com `pv`, olha também os próximos lances da linha. */
export function styleScore(fen: string, uci: string, personalityId: PersonalityId, pv?: string): number | null {
  const played = playToken(fen, uci);
  if (!played) return null;
  const personality = personalityById(personalityId);
  const features = pv && pv.trim().split(/\s+/)[0] === uci ? lineFeatures(fen, pv) : featuresOf(fen, played.move, played.chess);
  return sumFeatures(applyWeights(features, personality.weights));
}

type Candidate = {
  uci: string;
  pv: string;
  san: string;
  score: number;
  mate: number | null;
  depth: number;
};

function candidatePool(fen: string, lines: ScoredLine[], bestmove: string): Candidate[] {
  const pool: Candidate[] = [];
  const seen = new Set<string>();
  const push = (uci: string, pv: string, score: number, mate: number | null, depth: number) => {
    if (!uci || uci === "(none)" || seen.has(uci)) return;
    const played = playToken(fen, uci);
    if (!played) return;
    seen.add(uci);
    pool.push({ uci, pv: pv || uci, san: played.move.san, score, mate, depth });
  };
  for (const line of lines) {
    const uci = line.pv.trim().split(/\s+/)[0] ?? "";
    push(uci, line.pv.trim(), engineScore(line), line.mate, line.depth ?? 0);
  }
  if (bestmove && !seen.has(bestmove)) {
    const top = pool.reduce((max, item) => Math.max(max, item.score), 0);
    const deepest = pool.reduce((max, item) => Math.max(max, item.depth), 0);
    push(bestmove, bestmove, top, null, deepest);
  }
  return pool;
}

function engineScore(line: ScoredLine): number {
  if (line.mate != null && line.mate !== 0) {
    return line.mate > 0 ? 100000 - line.mate * 50 : -100000 - line.mate * 50;
  }
  return line.scoreCp ?? -30000;
}

const HORIZON_PLIES = 4;

function playIn(chess: Chess, uci: string): Move | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return (
      chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
      }) ?? null
    );
  } catch {
    return null;
  }
}

/** Estilo do lance visto pela linha do motor: o 1º lance mais o que os próximos custam ou rendem (sacrifício de verdade). */
function lineFeatures(fen: string, pv: string): Features {
  const tokens = pv.trim().split(/\s+/).filter(Boolean);
  const first = playToken(fen, tokens[0] ?? "");
  if (!first) return zeroFeatures();
  const base = featuresOf(fen, first.move, first.chess);
  if (tokens.length < 2) return base;

  const us = first.move.color;
  const them: Color = us === "w" ? "b" : "w";
  const walker = new Chess(fen);
  const startMap = occupy(walker);
  const startNet = material(startMap, us) - material(startMap, them);
  const limit = Math.min(tokens.length, HORIZON_PLIES);
  let worst = 0;
  let endNet = 0;
  let endMap = startMap;
  let played = 0;
  let checks = 0;
  for (let i = 0; i < limit; i += 1) {
    const step = playIn(walker, tokens[i] ?? "");
    if (!step) break;
    played = i + 1;
    if (i % 2 === 0 && step.san.includes("+")) checks += 1;
    // Só mede o material em posição "assentada": depois da resposta do adversário (ou no fim da linha).
    if (played % 2 === 0 || played === limit) {
      const map = occupy(walker);
      const net = material(map, us) - material(map, them) - startNet;
      worst = Math.min(worst, net);
      endNet = net;
      endMap = map;
    }
  }
  if (played < 2) return base;

  const deficit = -worst;
  const recovered = endNet >= -0.3 ? 0.4 : 1;
  const sacrifice = deficit >= 0.8 ? clamp((deficit * recovered) / 1.15, 0, 3.5) : 0;
  const horizonKing = clamp((kingPressure(endMap, us) - kingPressure(startMap, us)) / 1.15, -1.5, 3);
  const kingAttack = Math.max(base.kingAttack, horizonKing * 0.85);
  const attackish = base.check > 0 || checks > 0 || kingAttack > 0.35 || base.storm > 0.2;
  const ourDelta = material(endMap, us) - material(startMap, us);
  const theirDelta = material(endMap, them) - material(startMap, them);

  return {
    ...base,
    check: Math.max(base.check, Math.min(1.45, checks * 0.7)),
    kingAttack,
    sacrifice,
    attackSac: attackish ? sacrifice : 0,
    gambit: !attackish && sacrifice > 0 && deficit <= 2.1 && (base.develop > 0 || base.center >= 0.6) ? sacrifice : 0,
    material: clamp(endNet / 1.1, -3, 3),
    trade: tradeScore(ourDelta, theirDelta),
    simplify: simplifyScore(startMap, endMap, endNet),
  };
}

function featuresOf(fen: string, move: Move, after: Chess): Features {
  const before = new Chess(fen);
  const us = move.color;
  const them: Color = us === "w" ? "b" : "w";
  const beforeMap = occupy(before);
  const afterMap = occupy(after);
  const ourDelta = material(afterMap, us) - material(beforeMap, us);
  const theirDelta = material(afterMap, them) - material(beforeMap, them);
  const net = ourDelta - theirDelta;
  const check = move.san.includes("#") ? 2.3 : move.san.includes("+") ? 1.45 : 0;
  const kingAttack = clamp((kingPressure(afterMap, us) - kingPressure(beforeMap, us)) / 1.15, -1.5, 3);
  const storm = pawnStorm(move, them, beforeMap);
  const tension = clamp(attackTension(beforeMap, afterMap, us) / 2.2, -1.5, 2.6);
  const attackish = check > 0 || kingAttack > 0.2 || storm > 0.2;
  const dev = development(move, before.moveNumber());
  const forcing = check > 0 || move.isCapture() || move.isPromotion() || kingAttack > 0.2 || tension > 0.25 || storm > 0.2;

  return {
    check,
    kingAttack,
    storm,
    center:
      (CENTER[move.to] ?? 0) +
      (move.piece === "p" && (CENTER[move.to] ?? 0) >= 1 ? 0.35 : 0) -
      (CENTER[move.from] ?? 0) * 0.25,
    develop: dev,
    castle: move.isKingsideCastle() || move.isQueensideCastle() ? 1.4 : 0,
    structure: clamp(structureDelta(beforeMap, afterMap, us), -2, 2),
    capture: move.captured ? PIECE_VALUE[move.captured] / 3 : move.isPromotion() ? 0.8 : 0,
    tension,
    bind: clamp(pinScore(afterMap, us) - pinScore(beforeMap, us), -1.5, 2.4),
    sacrifice: net <= -0.8 ? clamp(-net / 1.15, 0, 3) : 0,
    attackSac: net <= -0.8 && attackish ? clamp(-net / 1.15, 0, 3) : 0,
    gambit: net <= -0.8 && net >= -2.1 && !attackish && (dev > 0 || (CENTER[move.to] ?? 0) >= 0.6) ? clamp(-net / 1.15, 0, 3) : 0,
    material: clamp(net / 1.1, -3, 3),
    trade: tradeScore(ourDelta, theirDelta),
    simplify: simplifyScore(beforeMap, afterMap, net),
    safety: safetyScore(move, beforeMap, afterMap, us),
    quiet: forcing ? 0 : 1,
    restraint: move.piece === "q" && before.moveNumber() <= 8 && !move.isCapture() && check === 0 ? -1 : 0,
  };
}

function development(move: Move, moveNumber: number): number {
  const home: Record<Color, Square[]> = {
    w: ["b1", "g1", "c1", "f1"],
    b: ["b8", "g8", "c8", "f8"],
  };
  let score = 0;
  if ((move.piece === "n" || move.piece === "b") && home[move.color].includes(move.from)) score += 1;
  if (move.piece === "q" && moveNumber <= 8 && !move.isCapture()) score -= 0.35;
  return score;
}

function pawnStorm(move: Move, them: Color, before: Map<Square, Occupant>): number {
  if (move.piece !== "p") return 0;
  const king = findKing(before, them);
  if (!king) return 0;
  const kingFile = fileOf(king);
  const wing = kingFile <= 2 || kingFile >= 5;
  if (!wing) return 0;
  const forward = move.color === "w" ? rankOf(move.to) - rankOf(move.from) : rankOf(move.from) - rankOf(move.to);
  if (forward <= 0) return 0;
  const fileGap = Math.abs(fileOf(move.to) - kingFile);
  if (fileGap > 1) return 0;
  return (2 - fileGap) * 0.7 * Math.min(2, forward);
}

function structureDelta(before: Map<Square, Occupant>, after: Map<Square, Occupant>, us: Color): number {
  const them: Color = us === "w" ? "b" : "w";
  return pawnQuality(after, us) - pawnQuality(before, us) - (pawnQuality(after, them) - pawnQuality(before, them));
}

function pawnQuality(map: Map<Square, Occupant>, color: Color): number {
  const files = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const [square, piece] of map) {
    if (piece.color === color && piece.type === "p") files[fileOf(square)] += 1;
  }
  let score = 0;
  for (let file = 0; file < 8; file += 1) {
    if (files[file] === 0) continue;
    if (files[file] > 1) score -= 0.42 * (files[file] - 1);
    const isolated = (file === 0 || files[file - 1] === 0) && (file === 7 || files[file + 1] === 0);
    if (files[file] === 1 && isolated) score -= 0.55;
    score += 0.04;
  }
  return score;
}

function attackTension(before: Map<Square, Occupant>, after: Map<Square, Occupant>, us: Color): number {
  return weightedAttacks(after, us) - weightedAttacks(before, us);
}

function weightedAttacks(map: Map<Square, Occupant>, us: Color): number {
  const them: Color = us === "w" ? "b" : "w";
  let score = 0;
  for (const [square, piece] of map) {
    if (piece.color !== us || piece.type === "k") continue;
    for (const target of attacksFrom(map, square, piece)) {
      const enemy = map.get(target);
      if (!enemy || enemy.color !== them || enemy.type === "k") continue;
      score += PIECE_VALUE[enemy.type] * 0.34;
    }
  }
  return score;
}

function pinScore(map: Map<Square, Occupant>, us: Color): number {
  let score = 0;
  for (const [square, piece] of map) {
    if (piece.color !== us) continue;
    if (piece.type !== "b" && piece.type !== "r" && piece.type !== "q") continue;
    const rays = piece.type === "b" ? BISHOP : piece.type === "r" ? ROOK : [...BISHOP, ...ROOK];
    const origin = coords(square);
    for (const [df, dr] of rays) {
      let first: Occupant | null = null;
      for (let step = 1; step < 8; step += 1) {
        const name = squareName(origin.f + df * step, origin.r + dr * step);
        if (!name) break;
        const occ = map.get(name);
        if (!occ) continue;
        if (!first) {
          if (occ.color === us) break;
          first = occ;
          continue;
        }
        if (occ.color !== us && PIECE_VALUE[first.type] >= 2.5 && (occ.type === "k" || PIECE_VALUE[occ.type] > PIECE_VALUE[first.type] + 0.2)) {
          score += occ.type === "k" ? 1.15 : 0.7;
        }
        break;
      }
    }
  }
  return score;
}

function tradeScore(ourDelta: number, theirDelta: number): number {
  const ourLoss = Math.max(0, -ourDelta);
  const theirLoss = Math.max(0, -theirDelta);
  if (ourLoss < 2.4 || theirLoss < 2.4) return 0;
  if (Math.abs(ourLoss - theirLoss) > 0.75) return 0;
  return clamp(Math.min(ourLoss, theirLoss) / 4.5, 0, 2);
}

function simplifyScore(before: Map<Square, Occupant>, after: Map<Square, Occupant>, net: number): number {
  const drop = officerCount(before) - officerCount(after);
  if (drop <= 0 || net < -1.3) return 0;
  return clamp(drop / 2, 0, 2);
}

function safetyScore(move: Move, before: Map<Square, Occupant>, after: Map<Square, Occupant>, us: Color): number {
  let score = 0;
  if (move.isKingsideCastle() || move.isQueensideCastle()) score += 1.15;
  if (move.piece === "k" && !move.isKingsideCastle() && !move.isQueensideCastle()) score -= 0.9;
  score += exposure(after, move.to, us) / 2.4;
  score += shelter(after, us) - shelter(before, us);
  if (
    move.piece === "p" &&
    (move.from === "f2" || move.from === "g2" || move.from === "h2" || move.from === "f7" || move.from === "g7" || move.from === "h7")
  ) {
    const king = findKing(before, us);
    if (king && fileOf(king) >= 4) score -= 0.18;
  }
  return clamp(score, -2.5, 2.2);
}

function exposure(map: Map<Square, Occupant>, square: Square, us: Color): number {
  const piece = map.get(square);
  if (!piece || piece.color !== us || piece.type === "k") return 0;
  const them: Color = us === "w" ? "b" : "w";
  const atk = attackersOf(map, square, them);
  if (atk.length === 0) return 0;
  const def = attackersOf(map, square, us);
  const cheapest = Math.min(...atk.map((item) => PIECE_VALUE[item.type]));
  const value = PIECE_VALUE[piece.type];
  if (def.length === 0) return -value;
  if (cheapest + 0.2 < value) return -(value - cheapest);
  return def.length >= atk.length ? 0 : -0.35;
}

function shelter(map: Map<Square, Occupant>, color: Color): number {
  const king = findKing(map, color);
  if (!king) return 0;
  const dir = color === "w" ? 1 : -1;
  let score = 0;
  for (const df of [-1, 0, 1]) {
    const name = squareName(fileOf(king) + df, rankOf(king) + dir);
    if (!name) continue;
    const piece = map.get(name);
    if (piece?.type === "p" && piece.color === color) score += 0.34;
  }
  return score;
}

function kingPressure(map: Map<Square, Occupant>, us: Color): number {
  const them: Color = us === "w" ? "b" : "w";
  const king = findKing(map, them);
  if (!king) return 0;
  let score = 0;
  for (const [square, piece] of map) {
    if (piece.color !== us || piece.type === "k") continue;
    const attacks = attacksFrom(map, square, piece);
    if (attacks.includes(king)) {
      score += piece.type === "q" ? 1.7 : piece.type === "n" ? 1.35 : piece.type === "b" ? 1.25 : piece.type === "r" ? 1.1 : 0.75;
      continue;
    }
    let zone = 0;
    for (const target of attacks) {
      if (chebyshev(target, king) === 1) zone += 1;
    }
    score += Math.min(3, zone) * (piece.type === "p" ? 0.28 : 0.4);
    const dist = chebyshev(square, king);
    if (piece.type === "n" && dist <= 3) score += (4 - dist) * 0.22;
  }
  return score;
}

function material(map: Map<Square, Occupant>, color: Color): number {
  let total = 0;
  for (const piece of map.values()) {
    if (piece.color === color) total += PIECE_VALUE[piece.type];
  }
  return total;
}

function officerCount(map: Map<Square, Occupant>): number {
  let total = 0;
  for (const piece of map.values()) {
    if (piece.type !== "k" && piece.type !== "p") total += 1;
  }
  return total;
}

const KNIGHT = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];
const KING = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const BISHOP: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function attacksFrom(map: Map<Square, Occupant>, square: Square, piece: Occupant): Square[] {
  const { f, r } = coords(square);
  const out: Square[] = [];
  const push = (file: number, rank: number) => {
    const name = squareName(file, rank);
    if (name) out.push(name);
  };
  if (piece.type === "n") {
    for (const [df, dr] of KNIGHT) push(f + df, r + dr);
  } else if (piece.type === "k") {
    for (const [df, dr] of KING) push(f + df, r + dr);
  } else if (piece.type === "p") {
    const dir = piece.color === "w" ? 1 : -1;
    push(f - 1, r + dir);
    push(f + 1, r + dir);
  } else {
    const rays = piece.type === "b" ? BISHOP : piece.type === "r" ? ROOK : [...BISHOP, ...ROOK];
    for (const [df, dr] of rays) {
      for (let step = 1; step < 8; step += 1) {
        const name = squareName(f + df * step, r + dr * step);
        if (!name) break;
        out.push(name);
        if (map.has(name)) break;
      }
    }
  }
  return out;
}

function attackersOf(map: Map<Square, Occupant>, target: Square, by: Color): Occupant[] {
  const list: Occupant[] = [];
  for (const [square, piece] of map) {
    if (piece.color !== by) continue;
    if (attacksFrom(map, square, piece).includes(target)) list.push(piece);
  }
  return list;
}

function occupy(chess: Chess): Map<Square, Occupant> {
  const map = new Map<Square, Occupant>();
  const board = chess.board();
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank]?.[file];
      if (!piece) continue;
      map.set(`${"abcdefgh"[file]}${8 - rank}` as Square, piece);
    }
  }
  return map;
}

function findKing(map: Map<Square, Occupant>, color: Color): Square | null {
  for (const [square, piece] of map) {
    if (piece.type === "k" && piece.color === color) return square;
  }
  return null;
}

function playToken(fen: string, uci: string): { chess: Chess; move: Move } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const chess = new Chess(fen);
  try {
    const move = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
    });
    return move ? { chess, move } : null;
  } catch {
    return null;
  }
}

function applyWeights(raw: Features, weights: Weights): Features {
  const out = zeroFeatures();
  for (const axis of Object.keys(raw) as Axis[]) out[axis] = raw[axis] * weights[axis];
  return out;
}

function sumFeatures(features: Features): number {
  return Object.values(features).reduce((sum, value) => sum + value, 0);
}

function reasonFor(chosen: Features | undefined, best: Features | undefined): string {
  if (!chosen || !best) return "segue o estilo";
  let axis: Axis = "quiet";
  let gap = 0;
  for (const key of Object.keys(chosen) as Axis[]) {
    const delta = chosen[key] - best[key];
    if (delta > gap) {
      gap = delta;
      axis = key;
    }
  }
  return gap > 0.05 ? AXIS_REASON[axis] : "segue o estilo";
}

function zeroFeatures(): Features {
  return {
    check: 0,
    kingAttack: 0,
    storm: 0,
    center: 0,
    develop: 0,
    castle: 0,
    structure: 0,
    capture: 0,
    tension: 0,
    bind: 0,
    sacrifice: 0,
    material: 0,
    trade: 0,
    simplify: 0,
    safety: 0,
    quiet: 0,
    restraint: 0,
    attackSac: 0,
    gambit: 0,
  };
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function fileOf(square: Square): number {
  return square.charCodeAt(0) - 97;
}

function rankOf(square: Square): number {
  return Number(square[1]) - 1;
}

function coords(square: Square): { f: number; r: number } {
  return { f: fileOf(square), r: rankOf(square) };
}

function squareName(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${"abcdefgh"[file]}${rank + 1}` as Square;
}

function chebyshev(a: Square, b: Square): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
