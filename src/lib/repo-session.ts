import type { GameFilters, GameRecord, GameResult } from "@/lib/games-db";
import type { GameSource } from "@/lib/importers/game-source";
import type { OpeningKind } from "@/lib/openings";
import type { Token } from "@/lib/search-tokens";

/**
 * Estado do repositório que sobrevive à troca de tela: o arquivo aberto, a página em que o jogador estava e
 * os filtros. Vive no módulo (não no componente), então sair e voltar não fecha nem relê o arquivo.
 */
export type RepoDraft = {
  tokens: Token[];
  appliedTokens: Token[];
  side: "any" | "white" | "black";
  outcome: "all" | "win" | "draw" | "loss";
  kind: OpeningKind | "gambit" | "all";
  result: GameResult | "all";
  family: string;
  elo: number;
  yearFrom: string;
  yearTo: string;
  source: string;
};

export type RepoSession = {
  mode: "file" | "local";
  pageSize: number;
  source: GameSource | null;
  fileInfo: { name: string; format: string } | null;
  pages: GameRecord[][];
  buffer: GameRecord[];
  pageIdx: number;
  moreAhead: boolean;
  applied: GameFilters;
  draft: RepoDraft | null;
  note: string;
};

export const repoSession: RepoSession = {
  mode: "file",
  pageSize: 25,
  source: null,
  fileInfo: null,
  pages: [],
  buffer: [],
  pageIdx: 0,
  moreAhead: false,
  applied: {},
  draft: null,
  note: "",
};

export function clearRepoSession() {
  repoSession.source?.close();
  repoSession.source = null;
  repoSession.fileInfo = null;
  repoSession.pages = [];
  repoSession.buffer = [];
  repoSession.pageIdx = 0;
  repoSession.moreAhead = false;
  repoSession.note = "";
}
