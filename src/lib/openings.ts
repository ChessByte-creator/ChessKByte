/**
 * Base de aberturas, defesas e gambitos do Byte Chess.
 * Dados: lichess-org/chess-openings (CC0), gerados por scripts/build-openings.mjs.
 * O match é feito por POSIÇÃO (EPD), então transposições são reconhecidas.
 */

export type OpeningKind = "opening" | "defense" | "gambit";

export type Opening = {
  id: number;
  eco: string;
  name: string;
  family: string;
  variation: string;
  kind: OpeningKind;
  /** Gambito em qualquer ponto do nome (ex.: Siciliana: Gambito Smith-Morra). */
  hasGambit: boolean;
  san: string[];
};

export type OpeningMatch = {
  /** Abertura mais profunda reconhecida na partida (ou null). */
  opening: Opening | null;
  /** Índice do ply onde essa abertura foi reconhecida. */
  openingPly: number;
  /** inBook[i] = a posição do ply i ainda é teoria (contíguo desde o início). */
  inBook: boolean[];
  /** names[i] = abertura mais profunda reconhecida até o ply i. */
  names: Array<Opening | null>;
  /** Primeiro ply que saiu da teoria (ou null se a partida inteira é livro). */
  leftBookAt: number | null;
};

export type OpeningsIndex = {
  entries: Opening[];
  byEpd: Map<string, Opening>;
  book: Set<string>;
};

type RawData = { v: number; entries: Array<[string, string, string]>; epd: Record<string, number>; book: string };

export function epdOf(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function hashText(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function kindOf(name: string): { kind: OpeningKind; hasGambit: boolean } {
  const family = name.split(":")[0] ?? name;
  const hasGambit = /gambit/i.test(name);
  if (/gambit/i.test(family)) return { kind: "gambit", hasGambit };
  if (/defen[cs]e/i.test(family)) return { kind: "defense", hasGambit };
  return { kind: "opening", hasGambit };
}

let cached: Promise<OpeningsIndex> | null = null;

/** Carrega os dados sob demanda (fora do bundle inicial). */
export function loadOpenings(): Promise<OpeningsIndex> {
  if (!cached) {
    cached = import("./openings-data.json").then((module) => {
      const data = (module.default ?? module) as unknown as RawData;
      const entries: Opening[] = data.entries.map(([eco, name, san], id) => {
        const [family, ...rest] = name.split(":");
        const { kind, hasGambit } = kindOf(name);
        return {
          id,
          eco,
          name,
          family: family.trim(),
          variation: rest.join(":").trim(),
          kind,
          hasGambit,
          san: san.split(" "),
        };
      });
      const byEpd = new Map<string, Opening>();
      for (const [key, id] of Object.entries(data.epd)) byEpd.set(key, entries[id]);
      return { entries, byEpd, book: new Set(data.book.split(" ")) };
    });
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Reconhece a abertura e marca quais lances ainda são de livro. `fens[0]` é a posição inicial. */
export function matchOpening(index: OpeningsIndex, fens: string[]): OpeningMatch {
  const inBook: boolean[] = [true];
  const names: Array<Opening | null> = [null];
  let opening: Opening | null = null;
  let openingPly = 0;
  let still = true;
  let leftBookAt: number | null = null;
  for (let i = 1; i < fens.length; i += 1) {
    const epd = epdOf(fens[i]);
    const named = index.byEpd.get(epd);
    if (named) {
      opening = named;
      openingPly = i;
    }
    still = still && (Boolean(named) || index.book.has(hashText(epd)));
    if (!still && leftBookAt === null) leftBookAt = i;
    inBook.push(still);
    names.push(opening);
  }
  return { opening, openingPly, inBook, names, leftBookAt };
}

export function filterOpenings(
  index: OpeningsIndex,
  opts: { query: string; kind: OpeningKind | "all"; eco?: string },
): Opening[] {
  const q = normalize(opts.query);
  return index.entries.filter((entry) => {
    if (opts.kind === "gambit" ? !(entry.kind === "gambit" || entry.hasGambit) : opts.kind !== "all" && entry.kind !== opts.kind) return false;
    if (opts.eco && !entry.eco.startsWith(opts.eco)) return false;
    if (!q) return true;
    const hay = normalize(`${entry.eco} ${entry.name} ${openingNamePt(entry.name)} ${entry.san.join(" ")}`);
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export const KIND_LABEL: Record<OpeningKind, string> = {
  opening: "Abertura",
  defense: "Defesa",
  gambit: "Gambito",
};

export const ECO_VOLUMES: Array<{ id: string; label: string }> = [
  { id: "A", label: "A · Flanco e irregulares" },
  { id: "B", label: "B · Semiaberta (e4)" },
  { id: "C", label: "C · Aberta (e4 e5) e Francesa" },
  { id: "D", label: "D · Fechada (d4 d5)" },
  { id: "E", label: "E · Indianas (d4 Cf6)" },
];

/** Famílias mais comuns em português. O que não está aqui fica no nome original. */
const PT_FAMILY: Record<string, string> = {
  "Italian Game": "Abertura Italiana",
  "Ruy Lopez": "Ruy Lopez (Espanhola)",
  "Scotch Game": "Abertura Escocesa",
  "Four Knights Game": "Jogo dos Quatro Cavalos",
  "Three Knights Opening": "Abertura dos Três Cavalos",
  "Vienna Game": "Abertura Vienense",
  "King's Gambit": "Gambito do Rei",
  "King's Gambit Accepted": "Gambito do Rei Aceito",
  "King's Gambit Declined": "Gambito do Rei Recusado",
  "Queen's Gambit": "Gambito da Dama",
  "Queen's Gambit Accepted": "Gambito da Dama Aceito",
  "Queen's Gambit Declined": "Gambito da Dama Recusado",
  "Sicilian Defense": "Defesa Siciliana",
  "French Defense": "Defesa Francesa",
  "Caro-Kann Defense": "Defesa Caro-Kann",
  "Pirc Defense": "Defesa Pirc",
  "Modern Defense": "Defesa Moderna",
  "Scandinavian Defense": "Defesa Escandinava",
  "Alekhine Defense": "Defesa Alekhine",
  "Petrov's Defense": "Defesa Petrov",
  "Philidor Defense": "Defesa Philidor",
  "Russian Game": "Jogo Russo (Defesa Petrov)",
  "Slav Defense": "Defesa Eslava",
  "Semi-Slav Defense": "Defesa Semieslava",
  "Nimzo-Indian Defense": "Defesa Nimzo-Indiana",
  "Queen's Indian Defense": "Defesa Índia da Dama",
  "King's Indian Defense": "Defesa Índia do Rei",
  "Grünfeld Defense": "Defesa Grünfeld",
  "Benoni Defense": "Defesa Benoni",
  "Benko Gambit": "Gambito Benko",
  "Dutch Defense": "Defesa Holandesa",
  "English Opening": "Abertura Inglesa",
  "Réti Opening": "Abertura Réti",
  "Catalan Opening": "Abertura Catalã",
  "London System": "Sistema Londres",
  "Trompowsky Attack": "Ataque Trompowsky",
  "Bird Opening": "Abertura Bird",
  "Larsen Opening": "Abertura Larsen",
  "Polish Opening": "Abertura Polonesa",
  "Zukertort Opening": "Abertura Zukertort",
  "Evans Gambit": "Gambito Evans",
  "Danish Gambit": "Gambito Dinamarquês",
  "Budapest Defense": "Defesa Budapeste",
  "Old Indian Defense": "Defesa Índia Antiga",
  "Owen Defense": "Defesa Owen",
  "Latvian Gambit": "Gambito Letão",
  "Elephant Gambit": "Gambito do Elefante",
  "Englund Gambit": "Gambito Englund",
  "Blackmar-Diemer Gambit": "Gambito Blackmar-Diemer",
  "Smith-Morra Gambit": "Gambito Smith-Morra",
  "Göring Gambit": "Gambito Göring",
  "Marshall Attack": "Ataque Marshall",
  "Center Game": "Jogo do Centro",
  "Bishop's Opening": "Abertura do Bispo",
  "Ponziani Opening": "Abertura Ponziani",
  "Sokolsky Opening": "Abertura Sokolsky (Orangotango)",
  "Hungarian Opening": "Abertura Húngara",
  "Dutch Defense: Leningrad Variation": "Defesa Holandesa: Leningrado",
  "Tarrasch Defense": "Defesa Tarrasch",
  "Queen's Pawn Game": "Jogo do Peão da Dama",
  "King's Pawn Game": "Jogo do Peão do Rei",
  "Indian Defense": "Defesa Indiana",
  "Colle System": "Sistema Colle",
  "Torre Attack": "Ataque Torre",
  "Stonewall Attack": "Ataque Stonewall",
  "Jobava London System": "Sistema Londres Jobava",
  "Nimzowitsch Defense": "Defesa Nimzowitsch",
  "St. George Defense": "Defesa St. George",
  "Portuguese Opening": "Abertura Portuguesa",
  "Van't Kruijs Opening": "Abertura Van't Kruijs",
  "Mieses Opening": "Abertura Mieses",
  "Nimzo-Larsen Attack": "Ataque Nimzo-Larsen",
  "Grob Opening": "Abertura Grob",
  "Anderssen Opening": "Abertura Anderssen",
  "Saragossa Opening": "Abertura Saragoça",
  "Barnes Opening": "Abertura Barnes",
};

const PT_WORDS: Record<string, string> = {
  Variation: "Variante",
  Defense: "Defesa",
  Defence: "Defesa",
  Gambit: "Gambito",
  Attack: "Ataque",
  Opening: "Abertura",
  Accepted: "Aceito",
  Declined: "Recusado",
  Game: "Jogo",
  Line: "Linha",
  Main: "Principal",
  Classical: "Clássica",
  Modern: "Moderna",
  Exchange: "Troca",
  Closed: "Fechada",
  Open: "Aberta",
  Advance: "Avanço",
  System: "Sistema",
  Counterattack: "Contra-ataque",
  Countergambit: "Contragambito",
  Accelerated: "Acelerado",
  Delayed: "Adiado",
  Symmetrical: "Simétrica",
  Normal: "Normal",
  Fianchetto: "Fianchetto",
  Improved: "Melhorada",
  Reversed: "Invertida",
  Hybrid: "Híbrida",
  Sacrifice: "Sacrifício",
  Pawn: "Peão",
  Knight: "Cavalo",
  Bishop: "Bispo",
  Queen: "Dama",
  King: "Rei",
  Rook: "Torre",
  Center: "Centro",
  Wing: "Flanco",
  Kingside: "Ala do Rei",
  Queenside: "Ala da Dama",
  Mainline: "Linha Principal",
};

function translateWords(text: string) {
  return text.replace(/[A-Za-zÀ-ÿ]+/g, (word) => PT_WORDS[word] ?? word);
}

/** "Najdorf Variation" → "Variante Najdorf": em português o substantivo vem antes do nome. */
function translateSegment(segment: string) {
  const text = segment.trim();
  const match = text.match(/^(.+?)\s+(Variation|Defense|Defence|Gambit|Attack|Opening|System|Line)$/);
  if (match) return `${PT_WORDS[match[2]]} ${translateWords(match[1])}`;
  return translateWords(text);
}

function translateVariation(text: string) {
  return text
    .split(",")
    .map((part) => translateSegment(part))
    .join(", ");
}

/** Traduz a família (antes dos dois pontos) quando conhecida e as palavras comuns das variantes. */
export function openingNamePt(name: string) {
  const [family, ...rest] = name.split(":");
  const key = family.trim();
  const pt = PT_FAMILY[key];
  if (!pt) return name;
  return rest.length > 0 ? `${pt}: ${translateVariation(rest.join(":"))}` : pt;
}

export function openingLine(entry: Opening) {
  const parts: string[] = [];
  for (let i = 0; i < entry.san.length; i += 1) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(entry.san[i]);
  }
  return parts.join(" ");
}
