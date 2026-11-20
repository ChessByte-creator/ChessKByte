import type { GameFilters } from "@/lib/games-db";
import { openingNamePt, type OpeningsIndex } from "@/lib/openings";

/** Um filtro escolhido na caixa de busca do repositório (aparece como "etiqueta" removível). */
export type Token =
  | { kind: "player"; name: string; id?: number; elo?: number }
  | { kind: "opening"; label: string; ecos: string[] }
  | { kind: "eco"; label: string; ecos: string[] }
  | { kind: "text"; value: string };

export function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenKey(token: Token) {
  switch (token.kind) {
    case "player":
      return `p:${token.id ?? norm(token.name)}`;
    case "opening":
    case "eco":
      return `${token.kind}:${token.label}`;
    case "text":
      return `t:${norm(token.value)}`;
  }
}

export function tokenLabel(token: Token) {
  switch (token.kind) {
    case "player":
      return token.name;
    case "opening":
    case "eco":
      return token.label;
    case "text":
      return `“${token.value}”`;
  }
}

/** "B" → B00..B99, "B9" → B90..B99, "B90" → ["B90"]. */
export function ecoRange(prefix: string): string[] {
  const p = prefix.toUpperCase();
  if (!/^[A-E]\d{0,2}$/.test(p)) return [];
  if (p.length === 3) return [p];
  const out: string[] = [];
  for (let n = 0; n < 100; n += 1) {
    const code = `${p[0]}${String(n).padStart(2, "0")}`;
    if (code.startsWith(p)) out.push(code);
  }
  return out;
}

export type Family = { family: string; pt: string; ecos: string[]; entries: number; search: string };

/** Famílias de abertura (Siciliana, Francesa…) com todos os códigos ECO que elas ocupam. */
export function buildFamilies(index: OpeningsIndex | null): Family[] {
  if (!index) return [];
  const map = new Map<string, { ecos: Set<string>; entries: number }>();
  for (const entry of index.entries) {
    const current = map.get(entry.family) ?? { ecos: new Set<string>(), entries: 0 };
    current.ecos.add(entry.eco);
    current.entries += 1;
    map.set(entry.family, current);
  }
  return [...map.entries()]
    .map(([family, value]) => {
      const pt = openingNamePt(family);
      return { family, pt, ecos: [...value.ecos].sort(), entries: value.entries, search: norm(`${pt} ${family}`) };
    })
    .sort((a, b) => b.entries - a.entries);
}

/** Aberturas que quase todo mundo procura primeiro (nomes do índice em inglês). */
const POPULAR = ["Sicilian Defense", "Italian Game", "Ruy Lopez", "French Defense", "Caro-Kann Defense", "Queen's Gambit", "King's Indian Defense", "English Opening", "Scandinavian Defense", "Nimzo-Indian Defense", "Slav Defense", "London System"];

export function popularFamilies(families: Family[]): Family[] {
  const out: Family[] = [];
  for (const name of POPULAR) {
    const hit = families.find((item) => item.family === name) ?? families.find((item) => item.family.startsWith(name));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export function familyToken(item: Family): Token {
  const range = item.ecos.length > 1 ? `${item.ecos[0]}–${item.ecos[item.ecos.length - 1]}` : item.ecos[0];
  return { kind: "opening", label: `${item.pt} (${range})`, ecos: item.ecos };
}

/** Famílias cujo nome (em português ou inglês) começa ou contém o texto, as que começam primeiro. */
export function searchFamilies(families: Family[], query: string, limit = 5): Family[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const starts: Family[] = [];
  const contains: Family[] = [];
  for (const item of families) {
    if (item.search.startsWith(q) || item.search.split(" ").some((word) => word.startsWith(q))) starts.push(item);
    else if (item.search.includes(q)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Converte as etiquetas em filtros: 1º jogador = quem se procura, 2º jogador = adversário. */
export function tokensToFilters(tokens: Token[]): GameFilters {
  const players = tokens.filter((token): token is Extract<Token, { kind: "player" }> => token.kind === "player");
  const ecos = new Set<string>();
  let hasEco = false;
  for (const token of tokens) {
    if (token.kind === "opening" || token.kind === "eco") {
      hasEco = true;
      for (const code of token.ecos) ecos.add(code);
    }
  }
  const textToken = [...tokens].reverse().find((token) => token.kind === "text");
  return {
    player: players[0]?.name,
    playerId: players[0]?.id,
    opponent: players[1]?.name,
    opponentId: players[1]?.id,
    ecoIn: hasEco ? [...ecos] : undefined,
    text: textToken?.kind === "text" ? textToken.value : undefined,
  };
}

const RECENT_KEY = "byte-repo-recent-tokens";

export function loadRecent(): Token[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Token[];
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object" && "kind" in item).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveRecent(tokens: Token[]) {
  if (tokens.length === 0) return;
  try {
    const merged = [...tokens, ...loadRecent()];
    const seen = new Set<string>();
    const unique = merged.filter((token) => {
      const key = tokenKey(token);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    localStorage.setItem(RECENT_KEY, JSON.stringify(unique.slice(0, 8)));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}
