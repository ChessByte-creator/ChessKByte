import type { GameRecord, GameResult } from "@/lib/games-db";

/** Dados de uma partida do repositório, mostrados na tela de análise para não perder de qual jogo se trata. */
export type GameInfo = {
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: GameResult;
  event: string;
  site: string;
  year: number;
  eco: string;
  opening: string;
  plies: number;
  timeControl: string;
  source: string;
};

export function infoFromRecord(game: GameRecord): GameInfo {
  return {
    white: game.white,
    black: game.black,
    whiteElo: game.whiteElo,
    blackElo: game.blackElo,
    result: game.result,
    event: game.event,
    site: game.site,
    year: game.year,
    eco: game.eco,
    opening: game.opening,
    plies: game.plies,
    timeControl: game.timeControl,
    source: game.source,
  };
}
