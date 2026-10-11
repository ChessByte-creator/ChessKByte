import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess, type Square } from "chess.js";
import { Board, type BoardArrow, type BoardBadge } from "@/components/chess/Board";
import { EvalBar } from "@/components/chess/EvalBar";
import { ReviewSummary } from "@/components/chess/ReviewSummary";
import { StockfishEngine, thinkBudget, type EngineLine } from "@/lib/engine";
import {
  JUDGMENT_META,
  gameAccuracy,
  emptyCounts,
  formatEval,
  formatPercent,
  isHarsh,
  judgmentInk,
  levelName,
  toWhiteEval,
  type Judgment,
  type JudgmentCounts,
  type WhiteEval,
} from "@/lib/eval";
import {
  appendMove,
  formatPv,
  isStandardStart,
  kingInCheck,
  pliesFromText,
  pliesKey,
  pgnOf,
  playUci,
  resultText,
  sanOfUci,
  startPlies,
  terminalEval,
  type Ply,
} from "@/lib/game";
import { loadOpenings, matchOpening, KIND_LABEL, openingNamePt, type OpeningsIndex } from "@/lib/openings";
import { isRecapture, judgePly, needsAfterSearch, type MoveReview, type ReviewState } from "@/lib/review";
import { loadAnalysis, saveAnalysis, type AnalysisRecord } from "@/lib/analysis-store";
import { buildAnalysisJson, buildAnnotatedPgn, downloadText, parseAnalysisFile } from "@/lib/analysis-file";
import { MAX_PREMOVES, applyPremoves, premoveTargets, resolvePremove, type Premove } from "@/lib/premove";
import { SHAPE_COLORS, toggleShape, type Shape, type ShapeColor } from "@/lib/shapes";
import { PERSONALITIES, personalityById, pickStyledMove, type PersonalityId } from "@/lib/style";
import { PuzzleScreen } from "@/components/chess/PuzzleScreen";
import { OpeningsScreen } from "@/components/chess/OpeningsScreen";
import { RepositoryScreen } from "@/components/chess/RepositoryScreen";
import { ByteMark } from "@/components/chess/ByteMark";
import { byteQuip } from "@/lib/byte-voice";

const STORAGE_KEY = "byte-chess-review-v1";
const LEGACY_STORAGE_KEY = "grok-chess-review-v1";
/** Força da revisão: profundidade e tempo máximo por posição (o que vier primeiro para a busca). */
type Strength = "fast" | "standard" | "deep";
const STRENGTHS: Record<Strength, { label: string; depth: number; movetime: number }> = {
  fast: { label: "Rápida", depth: 12, movetime: 1800 },
  standard: { label: "Padrão", depth: 16, movetime: 4000 },
  deep: { label: "Profunda", depth: 20, movetime: 9000 },
};
const ZERO: WhiteEval = { cp: 0, mate: null };

type Mode = "play" | "analyze";
type View = "match" | "duel" | "puzzle" | "library" | "repo";
type Tab = "game" | "engine" | "review";
type Promo = "q" | "r" | "b" | "n";
type BotSeat = { styleId: PersonalityId; rating: number };
type DuelScore = { w: number; d: number; b: number };

const DUEL_KEY = "byte-chess-duel-v1";
const PREFS_KEY = "byte-chess-prefs-v1";
const LEGACY_DUEL_KEY = "grok-chess-duel-v1";
const PACES = [
  { id: 400, label: "Rápido" },
  { id: 800, label: "Normal" },
  { id: 1500, label: "Lento" },
] as const;

const PROMO_LABEL: Record<Promo, string> = {
  q: "Dama",
  r: "Torre",
  b: "Bispo",
  n: "Cavalo",
};

function asPromo(piece: string | undefined): Promo | undefined {
  if (piece === "q" || piece === "r" || piece === "b" || piece === "n") return piece;
  return undefined;
}

export function ChessApp() {
  const [plies, setPlies] = useState<Ply[]>(startPlies);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>("play");
  const [player, setPlayer] = useState<"w" | "b">("w");
  const [flipped, setFlipped] = useState(false);
  const [skill, setSkill] = useState(10);
  const [styleId, setStyleId] = useState<PersonalityId>("balanced");
  const [remark, setRemark] = useState("");
  const [selected, setSelected] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square; color: "w" | "b" } | null>(null);
  const [tab, setTab] = useState<Tab>("game");
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [depth, setDepth] = useState(0);
  const [live, setLive] = useState<WhiteEval>(ZERO);
  const [thinking, setThinking] = useState(false);
  const [enginePhase, setEnginePhase] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState("");
  const [altFor, setAltFor] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [shapesByFen, setShapesByFen] = useState<Record<string, Shape[]>>({});
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState<ShapeColor>("green");
  const [premoves, setPremoves] = useState<Premove[]>([]);
  const [visited, setVisited] = useState({ puzzle: false, repo: false });
  const [premoveOn, setPremoveOn] = useState(true);
  const [strength, setStrength] = useState<Strength>("standard");
  const [searchGen, setSearchGen] = useState(0);
  const [openings, setOpenings] = useState<OpeningsIndex | null>(null);
  const [quip, setQuip] = useState(() => byteQuip(0));
  const [view, setView] = useState<View>("match");
  const [whiteBot, setWhiteBot] = useState<BotSeat>({ styleId: "aggressive", rating: 1600 });
  const [blackBot, setBlackBot] = useState<BotSeat>({ styleId: "positional", rating: 1600 });
  const [duelRun, setDuelRun] = useState(false);
  const [duelPace, setDuelPace] = useState<(typeof PACES)[number]["id"]>(800);
  const [duelScore, setDuelScore] = useState<DuelScore>({ w: 0, d: 0, b: 0 });

  const engineRef = useRef<StockfishEngine | null>(null);
  const pliesRef = useRef(plies);
  const cursorRef = useRef(cursor);
  const modeRef = useRef(mode);
  const playerRef = useRef(player);
  const viewRef = useRef(view);
  const duelRunRef = useRef(duelRun);
  const holdRef = useRef(false);
  const jobRef = useRef(0);
  const scoredRef = useRef("");
  const matchSnap = useRef<{ plies: Ply[]; cursor: number; mode: Mode; player: "w" | "b"; flipped: boolean; remark: string } | null>(null);
  const reviewsRef = useRef(reviews);
  const shapesRef = useRef<Record<string, Shape[]>>({});
  const analysisFileRef = useRef<HTMLInputElement>(null);
  const duelSnap = useRef<{ plies: Ply[]; cursor: number; flipped: boolean; remark: string } | null>(null);
  pliesRef.current = plies;
  cursorRef.current = cursor;
  modeRef.current = mode;
  playerRef.current = player;
  viewRef.current = view;
  duelRunRef.current = duelRun;

  const key = pliesKey(plies);
  reviewsRef.current = reviews;
  shapesRef.current = shapesByFen;
  const activeReview = reviews[key] ?? null;
  const reviewRunning = activeReview?.status === "running";
  const atTip = cursor === plies.length - 1 && altFor == null;
  const viewIndex = altFor != null ? altFor - 1 : cursor;
  const boardFen = plies[Math.max(0, viewIndex)]?.fen ?? plies[0].fen;
  const turn = new Chess(boardFen).turn();
  const outcome = resultText(plies[plies.length - 1]?.fen ?? boardFen);
  const canMove =
    view === "match" &&
    atTip &&
    !reviewRunning &&
    enginePhase === "ready" &&
    (mode === "analyze" || new Chess(plies[cursor].fen).turn() === player);

  const sideView = view === "puzzle" || view === "library" || view === "repo";
  const myTurn = new Chess(plies[cursor]?.fen ?? plies[0].fen).turn() === player;
  const canPremove = premoveOn && view === "match" && mode === "play" && atTip && !outcome && !myTurn && !reviewRunning && enginePhase === "ready";
  /** Com premoves em fila, o tabuleiro mostra a posição como ficará depois deles. */
  const virtualFen = canPremove && premoves.length > 0 ? applyPremoves(plies[cursor].fen, premoves) : null;

  const book = useMemo(() => (openings && isStandardStart(plies) ? matchOpening(openings, plies.map((ply) => ply.fen)) : null), [openings, plies]);
  const openingNow = book ? book.names[Math.min(cursor, book.names.length - 1)] : null;

  const shownEval = useMemo(() => {
    const terminal = terminalEval(boardFen);
    if (terminal) return terminal;
    if (activeReview?.status === "done") {
      if (altFor && activeReview.moves[altFor]) return activeReview.moves[altFor].evalBefore;
      if (cursor > 0 && activeReview.moves[cursor]) return activeReview.moves[cursor].evalAfter;
      if (cursor === 0 && activeReview.moves[1]) return activeReview.moves[1].evalBefore;
    }
    return live;
  }, [activeReview, altFor, boardFen, cursor, live]);

  const summary = useMemo(() => {
    if (!activeReview) return null;
    const bag: Record<"w" | "b", number[]> = { w: [], b: [] };
    const all: Record<"w" | "b", number[]> = { w: [], b: [] };
    const counts: Record<"w" | "b", JudgmentCounts> = { w: emptyCounts(), b: emptyCounts() };
    for (const [index, item] of Object.entries(activeReview.moves)) {
      const ply = plies[Number(index)];
      if (!ply?.color) continue;
      all[ply.color].push(item.accuracy);
      // Lances de livro e lances forçados não dizem nada sobre o jogador: ficam fora da média.
      if (item.judgment !== "book" && !item.forced) bag[ply.color].push(item.accuracy);
      counts[ply.color][item.judgment] += 1;
    }
    const pick = (color: "w" | "b") => gameAccuracy(bag[color].length > 0 ? bag[color] : all[color]);
    return { white: pick("w"), black: pick("b"), counts };
  }, [activeReview, plies]);

  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;
    engine.start();
    let alive = true;
    engine.ready.then(() => {
      if (alive) setEnginePhase("ready");
    }).catch(() => {
      if (alive) setEnginePhase("error");
    });
    return () => {
      alive = false;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (view === "puzzle" || view === "repo") {
      setVisited((current) => (current[view] ? current : { ...current, [view]: true }));
    }
  }, [view]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { premove?: boolean; drawColor?: string; strength?: string };
      if (typeof saved.premove === "boolean") setPremoveOn(saved.premove);
      if (saved.strength && saved.strength in STRENGTHS) setStrength(saved.strength as Strength);
      if (saved.drawColor && saved.drawColor in SHAPE_COLORS) setDrawColor(saved.drawColor as ShapeColor);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ premove: premoveOn, drawColor, strength }));
    } catch {
      /* ignore quota */
    }
  }, [drawColor, premoveOn, strength]);

  // A análise fica guardada até o PGN ou o FEN mudarem: ao voltar para a mesma partida, ela reaparece.
  useEffect(() => {
    if (view !== "match") return;
    let alive = true;
    const handle = window.setTimeout(() => {
      if (reviewsRef.current[key]) return;
      loadAnalysis(key)
        .then((record) => {
          if (!alive || !record) return;
          const saved = record.review;
          if (saved && !reviewsRef.current[record.key]) {
            setReviews((current) => (current[record.key] ? current : { ...current, [record.key]: { key: record.key, ...saved, status: "done" } }));
          }
          if (Object.keys(record.shapes).length > 0) setShapesByFen((current) => ({ ...record.shapes, ...current }));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [key, view]);

  useEffect(() => {
    if (view !== "match" || plies.length < 2) return;
    const finished = activeReview?.status === "done" ? activeReview : null;
    const fens = new Set(plies.map((item) => item.fen));
    const hasShapes = Object.entries(shapesByFen).some(([fen, list]) => fens.has(fen) && list.length > 0);
    if (!finished && !hasShapes) return;
    const handle = window.setTimeout(() => {
      void saveAnalysis(analysisRecord(plies, finished, shapesByFen)).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [activeReview, plies, shapesByFen, view]);

  useEffect(() => {
    let alive = true;
    loadOpenings()
      .then((index) => {
        if (alive) setOpenings(index);
      })
      .catch(() => {
        /* sem a base de aberturas o app segue funcionando, só sem os nomes */
      });
    setQuip(byteQuip(Math.floor(Math.random() * 1000)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        pgn?: string;
        player?: "w" | "b";
        skill?: number;
        style?: string;
        flipped?: boolean;
        mode?: Mode;
      };
      if (saved.player === "w" || saved.player === "b") setPlayer(saved.player);
      if (typeof saved.skill === "number") setSkill(Math.max(0, Math.min(20, saved.skill)));
      if (typeof saved.style === "string") setStyleId(personalityById(saved.style).id);
      if (typeof saved.flipped === "boolean") setFlipped(saved.flipped);
      if (saved.mode === "play" || saved.mode === "analyze") setMode(saved.mode);
      if (saved.pgn) {
        const next = pliesFromText(saved.pgn);
        if (next && next.length > 1) {
          setPlies(next);
          setCursor(next.length - 1);
        }
      }
    } catch {
      /* ignore broken saves */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DUEL_KEY) ?? localStorage.getItem(LEGACY_DUEL_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        whiteStyle?: string;
        blackStyle?: string;
        whiteRating?: number;
        blackRating?: number;
        pace?: number;
        score?: DuelScore;
      };
      if (saved.whiteStyle) setWhiteBot({ styleId: personalityById(saved.whiteStyle).id, rating: clampRating(saved.whiteRating) });
      if (saved.blackStyle) setBlackBot({ styleId: personalityById(saved.blackStyle).id, rating: clampRating(saved.blackRating) });
      if (saved.pace === 400 || saved.pace === 800 || saved.pace === 1500) setDuelPace(saved.pace);
      if (saved.score && typeof saved.score.w === "number") setDuelScore(saved.score);
    } catch {
      /* ignore broken duel settings */
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(
          DUEL_KEY,
          JSON.stringify({
            whiteStyle: whiteBot.styleId,
            blackStyle: blackBot.styleId,
            whiteRating: whiteBot.rating,
            blackRating: blackBot.rating,
            pace: duelPace,
            score: duelScore,
          }),
        );
      } catch {
        /* ignore quota */
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [blackBot, duelPace, duelScore, whiteBot]);
  useEffect(() => {
    if (view !== "match") return;
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ pgn: pgnOf(plies), player, skill, style: styleId, flipped, mode }),
        );
      } catch {
        /* ignore quota */
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [flipped, mode, player, plies, skill, styleId, view]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (viewRef.current !== "match" && viewRef.current !== "duel") return;
      if (event.key === "ArrowLeft") {
        setAltFor(null);
        setCursor((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        setAltFor(null);
        setCursor((current) => Math.min(pliesRef.current.length - 1, current + 1));
      } else if (event.key === "f" || event.key === "F") {
        setFlipped((value) => !value);
      } else if (event.key === "Escape") {
        setPremoves([]);
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || enginePhase !== "ready") return;
    if (holdRef.current) return;
    const fen = plies[cursor]?.fen;
    if (!fen) return;
    const terminal = terminalEval(fen);
    if (terminal) {
      setLive(terminal);
      setLines([]);
      setDepth(0);
      setThinking(false);
      return;
    }
    if (sideView) {
      setThinking(false);
      return;
    }
    const chess = new Chess(fen);
    const atLiveTip = cursor === plies.length - 1;
    const duelPlaying = view === "duel" && duelRun && atLiveTip;
    const humanEngine = view === "match" && mode === "play" && atLiveTip && chess.turn() !== player;
    const engineToMove = duelPlaying || humanEngine;
    const seat = chess.turn() === "w" ? whiteBot : blackBot;
    let dead = false;
    setThinking(engineToMove);
    const activeStyle = engineToMove && duelPlaying ? seat.styleId : styleId;
    const styled = activeStyle !== "balanced";
    const level = duelPlaying ? seatSkill(seat) : skill;
    const budget = thinkBudget(level, { styled, pace: duelPlaying ? duelPace : null });
    const request = engineToMove
      ? { fen, ...budget }
      : { fen, depth: 14, movetime: 1400, multipv: 3 };

    void engine
      .search(request, (update) => {
        if (dead || update.fen !== fen) return;
        setDepth(update.depth);
        if (!engineToMove) setLines(update.lines);
        const top = update.lines.find((line) => line.multipv === 1) ?? update.lines[0];
        if (top) setLive(toWhiteEval(top.scoreCp, top.mate, chess.turn()));
      })
      .then((result) => {
        if (dead || result.cancelled || result.fen !== fen || !engineToMove) {
          if (!dead && !engineToMove) setThinking(false);
          return;
        }
        setThinking(false);
        if (duelPlaying) {
          if (viewRef.current !== "duel" || !duelRunRef.current) return;
        } else if (viewRef.current !== "match" || modeRef.current !== "play") {
          return;
        }
        if (cursorRef.current !== pliesRef.current.length - 1) return;
        if (pliesRef.current[pliesRef.current.length - 1]?.fen !== fen) return;
        const choice = pickStyledMove({
          fen,
          lines: result.lines,
          bestmove: result.bestmove,
          personalityId: activeStyle,
          skill: duelPlaying ? seatSkill(seat) : skill,
          depth: result.depth,
        });
        const played = playUci(fen, choice.uci);
        if (!played) return;
        const sideName = chess.turn() === "w" ? "Brancas" : "Pretas";
        const who = personalityById(activeStyle).name;
        setRemark(duelPlaying ? (choice.note ? `${sideName} · ${choice.note}` : `${sideName} · ${who} jogou ${choice.san}.`) : choice.note);
        const next = appendMove(pliesRef.current, fen, played.from, played.to, asPromo(played.promotion));
        if (!next) return;
        setPlies(next.plies);
        setCursor(next.plies.length - 1);
        setSelected(null);
        setPromo(null);
        setAltFor(null);
      })
      .catch(() => {
        if (!dead) setThinking(false);
      });

    return () => {
      dead = true;
      if (!holdRef.current) void engine.cancel();
    };
  }, [blackBot, cursor, duelPace, duelRun, enginePhase, mode, player, plies, searchGen, sideView, skill, styleId, view, whiteBot]);

  useEffect(() => {
    if (view !== "duel") return;
    const last = plies[plies.length - 1]?.fen;
    if (!last || cursor !== plies.length - 1) return;
    const result = resultText(last);
    if (!result) return;
    const id = pliesKey(plies);
    if (scoredRef.current === id) return;
    scoredRef.current = id;
    setDuelRun(false);
    setDuelScore((score) => {
      if (result.includes("brancas")) return { ...score, w: score.w + 1 };
      if (result.includes("pretas")) return { ...score, b: score.b + 1 };
      return { ...score, d: score.d + 1 };
    });
  }, [cursor, plies, view]);

  const commit = useCallback((from: Square, to: Square, promotion?: Promo) => {
    const current = pliesRef.current;
    const fen = current[current.length - 1]?.fen;
    if (!fen || cursorRef.current !== current.length - 1) return;
    const next = appendMove(current, fen, from, to, promotion);
    if (!next) return;
    setPlies(next.plies);
    setCursor(next.plies.length - 1);
    setSelected(null);
    setPromo(null);
    setAltFor(null);
    setRemark("");
  }, []);

  function selectSquare(square: Square) {
    if (canPremove) {
      selectForPremove(square);
      return;
    }
    if (!canMove) return;
    const fen = plies[plies.length - 1]?.fen;
    if (!fen) return;
    if (selected) {
      const legal = new Chess(fen).moves({ square: selected, verbose: true });
      if (legal.some((move) => move.to === square)) {
        tryMove(selected, square);
        return;
      }
    }
    const piece = new Chess(fen).get(square);
    if (piece && piece.color === new Chess(fen).turn() && (mode === "analyze" || piece.color === player)) {
      setSelected(square);
      return;
    }
    setSelected(null);
  }

  useEffect(() => {
    if (premoves.length === 0) return;
    if (view !== "match" || mode !== "play" || !premoveOn) {
      setPremoves([]);
      return;
    }
    if (altFor != null || cursor !== plies.length - 1) {
      setPremoves([]);
      return;
    }
    const last = plies[plies.length - 1];
    if (resultText(last.fen)) {
      setPremoves([]);
      return;
    }
    if (new Chess(last.fen).turn() !== player) return;
    const resolved = resolvePremove(last.fen, premoves[0]);
    const handle = window.setTimeout(() => {
      if (resolved) {
        setPremoves((current) => current.slice(1));
        commit(resolved.from, resolved.to, resolved.promotion);
      } else {
        setPremoves([]);
        setRemark("Premoves cancelados: um lance deixou de ser legal.");
      }
    }, 140);
    return () => window.clearTimeout(handle);
  }, [altFor, commit, cursor, mode, plies, player, premoves, premoveOn, view]);

  /** Na vez do adversário: cada lance escolhido entra na fila (até MAX_PREMOVES), sempre sobre a posição virtual. */
  function selectForPremove(square: Square) {
    const real = pliesRef.current[pliesRef.current.length - 1]?.fen;
    if (!real) return;
    const base = applyPremoves(real, premoves);
    if (selected) {
      if (premoveTargets(base, selected).includes(square)) {
        if (premoves.length < MAX_PREMOVES) setPremoves([...premoves, { from: selected, to: square }]);
        else setRemark(`Limite de ${MAX_PREMOVES} premoves.`);
        setSelected(null);
        return;
      }
      if (square === selected) {
        setSelected(null);
        return;
      }
    }
    if (new Chess(base).get(square)?.color === player) {
      setSelected(square);
      return;
    }
    setSelected(null);
    if (!selected) setPremoves([]);
  }

  function tryMove(from: Square, to: Square) {
    if (canPremove) {
      const real = pliesRef.current[pliesRef.current.length - 1]?.fen;
      if (real && premoves.length < MAX_PREMOVES && premoveTargets(applyPremoves(real, premoves), from).includes(to)) {
        setPremoves([...premoves, { from, to }]);
      }
      setSelected(null);
      return;
    }
    if (!canMove) return;
    const fen = pliesRef.current[pliesRef.current.length - 1]?.fen;
    if (!fen) return;
    const options = new Chess(fen).moves({ square: from, verbose: true }).filter((move) => move.to === to);
    if (options.length === 0) {
      selectSquare(to);
      return;
    }
    const promotions = options.filter((move) => move.promotion);
    if (promotions.length > 1) {
      setPromo({ from, to, color: new Chess(fen).turn() });
      setSelected(null);
      return;
    }
    commit(from, to, asPromo(promotions[0]?.promotion));
  }

  /** Interrompe a revisão em andamento e guarda o que já foi avaliado como parcial. */
  function haltReview() {
    jobRef.current += 1;
    holdRef.current = false;
    void engineRef.current?.cancel();
    setReviews((current) => {
      let changed = false;
      const next: Record<string, ReviewState> = {};
      for (const [id, item] of Object.entries(current)) {
        if (item.status === "running") {
          changed = true;
          next[id] = { ...item, status: "done", partial: true };
        } else next[id] = item;
      }
      return changed ? next : current;
    });
  }

  function stopReview() {
    haltReview();
    setSearchGen((value) => value + 1);
  }

  const putReview = useCallback((state: ReviewState) => {
    setReviews((current) => {
      const next = { ...current, [state.key]: state };
      const keys = Object.keys(next);
      for (const id of keys.slice(0, Math.max(0, keys.length - 12))) {
        if (id !== state.key && next[id].status !== "running") delete next[id];
      }
      return next;
    });
  }, []);

  function resetTo(next: Ply[], nextMode: Mode, color: "w" | "b") {
    haltReview();
    setShapesByFen({});
    setPremoves([]);
    setPlies(next);
    setCursor(next.length - 1);
    setMode(nextMode);
    setPlayer(color);
    setSelected(null);
    setPromo(null);
    setAltFor(null);
    setLines([]);
    setLive(ZERO);
    setRemark("");
    setSearchGen((value) => value + 1);
  }

  function openView(next: View) {
    if (next === viewRef.current) return;
    setPremoves([]);
    // O duelo usa o motor; as outras abas deixam a revisão terminar em segundo plano.
    if (next === "duel") haltReview();
    if (viewRef.current === "match") {
      matchSnap.current = {
        plies: pliesRef.current,
        cursor: cursorRef.current,
        mode: modeRef.current,
        player: playerRef.current,
        flipped,
        remark,
      };
    } else if (viewRef.current === "duel") {
      duelSnap.current = { plies: pliesRef.current, cursor: cursorRef.current, flipped, remark };
      setDuelRun(false);
    }
    if (next === "match") {
      const snap = matchSnap.current;
      setView("match");
      if (!snap) return;
      setPlies(snap.plies);
      setCursor(snap.cursor);
      setMode(snap.mode);
      setPlayer(snap.player);
      setFlipped(snap.flipped);
      setRemark(snap.remark);
      setSelected(null);
      setPromo(null);
      setAltFor(null);
      setSearchGen((value) => value + 1);
      return;
    }
    if (next === "duel") {
      setView("duel");
      setDuelRun(false);
      const snap = duelSnap.current;
      if (snap) {
        setPlies(snap.plies);
        setCursor(snap.cursor);
        setFlipped(snap.flipped);
        setRemark(snap.remark);
        setMode("play");
        setSelected(null);
        setPromo(null);
        setAltFor(null);
        setSearchGen((value) => value + 1);
      } else {
        resetTo(startPlies(), "play", "w");
      }
      return;
    }
    setDuelRun(false);
    setView(next);
    if (!holdRef.current) void engineRef.current?.cancel();
  }

  /** Abre uma linha de abertura ou uma partida do repositório no modo análise. */
  function openLineInAnalysis(next: Ply[], at: "start" | "end" = "end") {
    setDuelRun(false);
    matchSnap.current = null;
    setView("match");
    resetTo(next, "analyze", "w");
    setFlipped(false);
    setTab("game");
    if (at === "start") setCursor(0);
    setNotice("Carregado no modo análise.");
  }

  /** Pula para o próximo lance da categoria escolhida (volta ao início quando acaba). */
  function jumpToJudgment(judgment: Judgment) {
    if (!activeReview) return;
    const hits = Object.entries(activeReview.moves)
      .filter(([, item]) => item.judgment === judgment)
      .map(([index]) => Number(index))
      .sort((a, b) => a - b);
    if (hits.length === 0) return;
    const current = altFor ?? cursor;
    const next = hits.find((index) => index > current) ?? hits[0];
    setAltFor(null);
    setCursor(next);
  }

  function newDuel() {
    setDuelRun(false);
    duelSnap.current = null;
    resetTo(startPlies(), "play", "w");
  }

  function newGame(color: "w" | "b") {
    resetTo(startPlies(), "play", color);
    setFlipped(color === "b");
    setNotice("");
    setTab("game");
  }

  function undo() {
    if (reviewRunning) return;
    const current = pliesRef.current;
    if (current.length <= 1) return;
    let cut = 1;
    if (view === "match" && mode === "play" && current.length > 2 && current[current.length - 1]?.color !== player) cut = 2;
    if (view === "duel") setDuelRun(false);
    const next = current.slice(0, current.length - cut);
    setPlies(next);
    setCursor(next.length - 1);
    setSelected(null);
    setPromo(null);
    setAltFor(null);
  }

  function loadPosition() {
    const next = pliesFromText(importText);
    if (!next) {
      setNotice("Não reconheci esse FEN ou PGN.");
      return;
    }
    resetTo(next, "analyze", player);
    setNotice("Posição carregada no modo análise.");
    setTab("engine");
  }

  const shapes = shapesByFen[boardFen] ?? [];

  function handleShape(shape: Shape) {
    setShapesByFen((current) => {
      const list = toggleShape(current[boardFen] ?? [], shape);
      const next = { ...current };
      if (list.length > 0) next[boardFen] = list;
      else delete next[boardFen];
      return next;
    });
  }

  function clearShapesHere() {
    setShapesByFen((current) => {
      if (!current[boardFen]?.length) return current;
      const next = { ...current };
      delete next[boardFen];
      return next;
    });
  }

  function exportPayload() {
    const accuracy = summary && summary.white != null && summary.black != null ? { white: summary.white, black: summary.black } : null;
    return {
      plies,
      review: activeReview,
      shapes: shapesByFen,
      opening: book?.opening ? { eco: book.opening.eco, name: book.opening.name } : null,
      accuracy,
    };
  }

  function fileStamp() {
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
  }

  function saveAnnotatedPgn() {
    downloadText(`byte-chess-${fileStamp()}.pgn`, buildAnnotatedPgn(exportPayload()), "application/x-chess-pgn");
    setNotice("PGN anotado salvo.");
  }

  function saveAnalysisFile() {
    downloadText(`byte-chess-analise-${fileStamp()}.json`, buildAnalysisJson(exportPayload()), "application/json");
    setNotice("Análise salva. Abra de novo com “Abrir arquivo”.");
  }

  async function openAnalysisFile(file: File) {
    if (file.size > 20_000_000) {
      setNotice("Arquivo grande demais para abrir aqui.");
      return;
    }
    const loaded = parseAnalysisFile(await file.text());
    if (!loaded) {
      setNotice("Não reconheci esse arquivo. Use uma análise do Byte Chess (.json), um PGN ou um FEN.");
      return;
    }
    resetTo(loaded.plies, "analyze", player);
    setShapesByFen(loaded.shapes);
    if (loaded.review) putReview(loaded.review);
    setTab(loaded.review ? "review" : "engine");
    setNotice(loaded.kind === "analysis" ? "Análise carregada." : "PGN carregado no modo análise.");
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copiado.`);
    } catch {
      setNotice(text);
    }
  }

  function analysisRecord(game: Ply[], state: ReviewState | null, drawings: Record<string, Shape[]>): AnalysisRecord {
    const fens = new Set(game.map((item) => item.fen));
    const shapes: Record<string, Shape[]> = {};
    for (const [fen, list] of Object.entries(drawings)) if (fens.has(fen) && list.length > 0) shapes[fen] = list;
    return {
      key: pliesKey(game),
      savedAt: Date.now(),
      startFen: game[0].fen,
      pgn: pgnOf(game),
      review: state ? { status: "done", progress: state.progress, total: state.total, partial: state.partial, moves: state.moves } : null,
      shapes,
    };
  }

  /** `resume`: continua de onde uma revisão parcial parou, sem refazer o que já foi avaliado. */
  async function runReview(resume = false) {
    const engine = engineRef.current;
    const snapshot = pliesRef.current;
    if (!engine || snapshot.length < 2 || enginePhase !== "ready") return;
    const job = ++jobRef.current;
    holdRef.current = true;
    const gameKey = pliesKey(snapshot);
    const total = snapshot.length - 1;
    const previous = resume ? reviewsRef.current[gameKey] : undefined;
    const moves: Record<number, MoveReview> = previous ? { ...previous.moves } : {};
    const startAt = previous ? Math.min(total, previous.progress) + 1 : 1;
    const bookMatch = openings && isStandardStart(snapshot) ? matchOpening(openings, snapshot.map((item) => item.fen)) : null;
    const power = STRENGTHS[strength];
    setTab("review");
    setAltFor(null);
    putReview({ key: gameKey, status: "running", progress: startAt - 1, total, partial: false, moves: { ...moves } });
    try {
      await engine.cancel();
      let prevLoss = moves[startAt - 1]?.winLoss ?? 0;
      // Cada posição é buscada UMA vez. A busca da posição k serve de "depois" do lance k e de "antes" do lance k+1,
      // como na Lichess: o lance é medido pela avaliação independente da posição que ele criou.
      let before: { fen: string; lines: EngineLine[]; bestmove: string } | null = null;
      for (let k = startAt - 1; k <= total; k += 1) {
        if (jobRef.current !== job) return;
        const fen = snapshot[k].fen;
        const terminal = terminalEval(fen);
        const bookHere = (bookMatch?.inBook[k] ?? false) && (k + 1 > total || (bookMatch?.inBook[k + 1] ?? false));
        let here: { fen: string; lines: EngineLine[]; bestmove: string } | null = null;
        let hereEval: WhiteEval;
        if (terminal) {
          hereEval = terminal;
        } else {
          const budget = bookHere ? { depth: 10, movetime: 500, multipv: 1 } : { depth: power.depth, movetime: power.movetime, multipv: 3 };
          const searched = await engine.search({ fen, ...budget });
          if (jobRef.current !== job || searched.cancelled) return;
          here = { fen, lines: searched.lines, bestmove: searched.bestmove };
          const top = searched.lines.find((line) => line.multipv === 1) ?? searched.lines[0];
          hereEval = top ? toWhiteEval(top.scoreCp, top.mate, new Chess(fen).turn()) : ZERO;
        }

        const index = k;
        const ply = snapshot[index];
        if (index >= startAt && before && ply?.uci && ply.color && ply.from && ply.to) {
          const uci = ply.uci;
          const color = ply.color;
          const beforeFen = before.fen;
          const inBook = bookMatch?.inBook[index] ?? false;
          const recapture = index >= 2 ? isRecapture(snapshot[index - 2].fen, snapshot[index - 1]?.uci, uci) : false;
          let lines = before.lines;
          let bestUci = before.bestmove;
          let afterEval: WhiteEval = hereEval;
          let shallowBest: string | undefined;
          const judge = () =>
            judgePly({
              beforeFen,
              uci,
              color,
              lines,
              bestUci,
              bestSan: sanOfUci(beforeFen, bestUci),
              afterEval,
              inBook,
              recapture,
              prevOpponentLoss: prevLoss,
              seed: index,
              shallowBest,
            });
          let result = judge();

          // "Ótimo" e "Brilhante" são raros: confirma com uma busca bem mais funda, antes e depois do lance.
          if (result.judgment === "great" || result.judgment === "brilliant") {
            const deepBudget = { depth: power.depth + 4, movetime: Math.round(power.movetime * 1.6) };
            const deep = await engine.search({ fen: beforeFen, ...deepBudget, multipv: 3 });
            if (jobRef.current !== job || deep.cancelled) return;
            lines = deep.lines;
            bestUci = deep.bestmove;
            const terminalAfter = terminalEval(ply.fen);
            if (terminalAfter) {
              afterEval = terminalAfter;
            } else {
              const deepAfter = await engine.search({ fen: ply.fen, ...deepBudget, multipv: 1 });
              if (jobRef.current !== job || deepAfter.cancelled) return;
              const top = deepAfter.lines.find((line) => line.multipv === 1) ?? deepAfter.lines[0];
              if (top) afterEval = toWhiteEval(top.scoreCp, top.mate, new Chess(ply.fen).turn());
            }
            result = judge();
            // Brilhante tem que ser difícil de achar: se um motor raso já escolhe esse lance, é óbvio.
            if (result.judgment === "brilliant") {
              const shallow = await engine.search({ fen: beforeFen, depth: 4, movetime: 400, multipv: 1 });
              if (jobRef.current !== job || shallow.cancelled) return;
              shallowBest = shallow.bestmove;
              result = judge();
            }
          }

          moves[index] = result;
          prevLoss = result.winLoss;
          putReview({ key: gameKey, status: "running", progress: index, total, partial: false, moves: { ...moves } });
          // Ponto de retorno: se a aba fechar no meio, o que já foi avaliado fica guardado.
          if (index % 10 === 0 && index < total) {
            void saveAnalysis(analysisRecord(snapshot, { key: gameKey, status: "done", progress: index, total, partial: true, moves: { ...moves } }, shapesRef.current)).catch(() => undefined);
          }
        }
        before = here;
      }
      if (jobRef.current !== job) return;
      putReview({ key: gameKey, status: "done", progress: total, total, partial: false, moves: { ...moves } });
    } finally {
      if (jobRef.current === job) {
        holdRef.current = false;
        setSearchGen((value) => value + 1);
      }
    }
  }

  const targets =
    selected && canMove
      ? [...new Set(new Chess(plies[cursor].fen).moves({ square: selected, verbose: true }).map((move) => move.to))]
      : selected && canPremove
        ? premoveTargets(virtualFen ?? plies[cursor].fen, selected)
        : [];

  const lastMove =
    altFor == null && cursor > 0 && plies[cursor]?.from && plies[cursor]?.to
      ? { from: plies[cursor].from, to: plies[cursor].to }
      : null;

  const arrows: BoardArrow[] = [];
  if (altFor && activeReview?.moves[altFor] && plies[altFor]?.from && plies[altFor]?.to) {
    const item = activeReview.moves[altFor];
    const ply = plies[altFor];
    const from = ply.from;
    const to = ply.to;
    if (from && to) {
      arrows.push({ from, to, tone: isHarsh(item.judgment) ? "bad" : "good" });
    }
    if (item.bestUci.length >= 4 && item.bestUci !== ply.uci) {
      arrows.push({
        from: item.bestUci.slice(0, 2) as Square,
        to: item.bestUci.slice(2, 4) as Square,
        tone: "good",
      });
    }
  }

  const focusIndex = altFor ?? cursor;
  const focusReview = focusIndex > 0 ? activeReview?.moves[focusIndex] : undefined;
  const focusPly = focusIndex > 0 ? plies[focusIndex] : undefined;

  const badge: BoardBadge | null =
    altFor == null && cursor > 0 && activeReview?.moves[cursor] && plies[cursor]?.to
      ? {
          square: plies[cursor].to as Square,
          glyph: JUDGMENT_META[activeReview.moves[cursor].judgment].glyph,
          color: JUDGMENT_META[activeReview.moves[cursor].judgment].color,
          label: JUDGMENT_META[activeReview.moves[cursor].judgment].label,
        }
      : null;

  const duelSeat = turn === "w" ? whiteBot : blackBot;
  const status = outcome && atTip
    ? outcome
    : !atTip
      ? "Revendo a partida."
      : thinking
        ? view === "duel"
          ? `${personalityById(duelSeat.styleId).name} pensando…${depth ? ` profundidade ${depth}` : ""}`
          : mode === "play" && turn !== player
            ? `${personalityById(styleId).name} pensando…${depth ? ` profundidade ${depth}` : ""}`
            : `Motor pensando…${depth ? ` profundidade ${depth}` : ""}`
        : view === "duel"
          ? duelRun
            ? turn === "w"
              ? "Brancas a jogar."
              : "Pretas a jogar."
            : "Duelo em pausa."
          : new Chess(boardFen).isCheck()
            ? turn === "w"
              ? "Brancas em xeque."
              : "Pretas em xeque."
            : mode === "play" && turn === player
              ? player === "w"
                ? "Sua vez, com as brancas."
                : "Sua vez, com as pretas."
              : turn === "w"
                ? "Brancas a jogar."
                : "Pretas a jogar.";

  const engineLabel =
    enginePhase === "ready" ? (thinking || reviewRunning ? "motor ocupado" : "motor pronto") : enginePhase === "error" ? "motor indisponível" : "a ligar o motor";

  const rows: Array<{ n: number; white?: number; black?: number }> = [];
  for (let index = 1; index < plies.length; index += 1) {
    if (index % 2 === 1) rows.push({ n: Math.floor((index - 1) / 2) + 1, white: index });
    else if (rows.length > 0) rows[rows.length - 1].black = index;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <ByteMark />
          <div>
            <h1 className="font-display text-3xl leading-none text-walnut">Byte Chess</h1>
            <p className="mt-1 text-sm text-muted">{quip}</p>
          </div>
        </div>
        <p className="text-sm text-muted">{sideView ? "Salvo neste aparelho" : engineLabel}</p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["match", "Partida"],
            ["duel", "Duelo"],
            ["puzzle", "Puzzles"],
            ["library", "Aberturas"],
            ["repo", "Repositório"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={btn(view === id)} onClick={() => openView(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Puzzles e Repositório ficam montados depois da primeira visita (só escondidos), para não perder o arquivo aberto. */}
      {view === "puzzle" || visited.puzzle ? (
        <div hidden={view !== "puzzle"}>
          <PuzzleScreen />
        </div>
      ) : null}
      {view === "repo" || visited.repo ? (
        <div hidden={view !== "repo"}>
          <RepositoryScreen openings={openings} onOpen={openLineInAnalysis} />
        </div>
      ) : null}
      {view === "puzzle" || view === "repo" ? null : view === "library" ? (
        <OpeningsScreen index={openings} onOpen={openLineInAnalysis} />
      ) : (
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex flex-col gap-3">
          <div className="mx-auto grid h-10 w-full max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <p className="truncate text-sm text-ink">{status}</p>
            <p className="row-span-2 font-mono text-sm tabular-nums text-ink">{formatEval(shownEval)}</p>
            <p className="truncate text-sm text-walnut" title={remark}>
              {remark || "\u00a0"}
            </p>
          </div>
          <div className="relative mx-auto flex w-full max-w-xl items-stretch gap-2">
            <EvalBar evalWhite={shownEval} flipped={flipped} />
            <div className="relative min-w-0 flex-1">
              <Board
                fen={virtualFen ?? boardFen}
                flipped={flipped}
                selected={selected}
                targets={targets}
                lastMove={lastMove}
                checkSquare={kingInCheck(boardFen)}
                arrows={arrows}
                badge={badge}
                shapes={shapes}
                onShape={handleShape}
                onClearShapes={clearShapesHere}
                drawMode={drawMode}
                drawColor={drawColor}
                premoveSquares={premoves.flatMap((item) => [item.from, item.to])}
                premoveColor={canPremove ? player : null}
                interactive={canMove || canPremove}
                player={mode === "analyze" ? "both" : player}
                onSquare={selectSquare}
                onDrop={tryMove}
              />
              {promo ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/35 p-4">
                  <div className="flex gap-2 rounded-3xl bg-paper p-3">
                    {(["q", "r", "b", "n"] as Promo[]).map((piece) => (
                      <button
                        key={piece}
                        type="button"
                        className="flex size-14 items-center justify-center rounded-lg bg-cream"
                        aria-label={PROMO_LABEL[piece]}
                        onClick={() => commit(promo.from, promo.to, piece)}
                      >
                        <img alt="" src={`/pieces/${promo.color}${piece.toUpperCase()}.svg`} className="size-10" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-xl flex-wrap gap-2">
            <button type="button" className={btn()} onClick={() => { setAltFor(null); setCursor((value) => Math.max(0, value - 1)); }} aria-label="Lance anterior">
              Anterior
            </button>
            <button
              type="button"
              className={btn()}
              onClick={() => { setAltFor(null); setCursor((value) => Math.min(plies.length - 1, value + 1)); }}
              aria-label="Lance seguinte"
            >
              Seguinte
            </button>
            <button type="button" className={btn()} onClick={() => setFlipped((value) => !value)}>
              Virar
            </button>
            {atTip ? (
              <button type="button" className={btn()} onClick={undo} disabled={plies.length < 2 || reviewRunning}>
                Desfazer
              </button>
            ) : (
              <button type="button" className={btn(true)} onClick={() => { setAltFor(null); setCursor(plies.length - 1); }}>
                Lance atual
              </button>
            )}
            {view === "duel" ? (
              <>
                <button
                  type="button"
                  className={btn(true)}
                  disabled={reviewRunning || Boolean(outcome && atTip)}
                  onClick={() => {
                    setAltFor(null);
                    setCursor(plies.length - 1);
                    setDuelRun((value) => !value);
                  }}
                >
                  {duelRun ? "Pausar" : plies.length > 1 && !outcome ? "Continuar" : "Começar"}
                </button>
                <button type="button" className={btn()} onClick={newDuel} disabled={reviewRunning}>
                  Nova partida
                </button>
              </>
            ) : (
              <>
                <button type="button" className={btn(true)} onClick={() => newGame("w")}>
                  Brancas
                </button>
                <button type="button" className={btn()} onClick={() => newGame("b")}>
                  Pretas
                </button>
              </>
            )}
          </div>
          <div className="mx-auto flex w-full max-w-xl flex-wrap items-center gap-2">
            <button type="button" className={btn(drawMode)} aria-pressed={drawMode} onClick={() => setDrawMode((value) => !value)}>
              Desenhar
            </button>
            {drawMode ? (
              <div className="flex items-center gap-1" role="group" aria-label="Cor do desenho">
                {(Object.keys(SHAPE_COLORS) as ShapeColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={SHAPE_COLORS[color].label}
                    aria-pressed={drawColor === color}
                    onClick={() => setDrawColor(color)}
                    className={`size-9 rounded-full border-2 ${drawColor === color ? "border-ink" : "border-transparent"}`}
                    style={{ backgroundColor: SHAPE_COLORS[color].hex }}
                  />
                ))}
              </div>
            ) : null}
            {shapes.length > 0 || Object.keys(shapesByFen).length > 0 ? (
              <button type="button" className={btn()} onClick={() => setShapesByFen({})}>
                Limpar desenhos
              </button>
            ) : null}
            {premoves.length > 0 ? (
              <button type="button" className={btn()} onClick={() => setPremoves([])}>
                Cancelar premoves ({premoves.length})
              </button>
            ) : null}
          </div>
          <p className="mx-auto w-full max-w-xl text-xs text-muted">
            Botão direito marca uma casa; arrastar com o direito desenha uma seta (Shift vermelho, Ctrl azul, Alt amarelo). No celular, ligue “Desenhar”.
            {premoveOn && mode === "play" ? " Na vez do adversário, escolha seu lance para agendar premoves em fila, até 10 (Esc cancela)." : ""}
          </p>
          {summary && activeReview?.status === "done" ? (
            <p className="mx-auto w-full max-w-xl text-sm text-muted">
              Precisão {formatPercent(summary.white)} brancas · {formatPercent(summary.black)} pretas
              {activeReview.partial ? " · avaliação parcial" : ""}
            </p>
          ) : null}
          {focusReview && focusPly?.san ? (
            <>
              <p className="mx-auto flex w-full max-w-xl items-center gap-2 text-sm font-semibold" style={{ color: judgmentInk(focusReview.judgment) }}>
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] leading-none font-bold text-white"
                  style={{ backgroundColor: JUDGMENT_META[focusReview.judgment].color }}
                >
                  {JUDGMENT_META[focusReview.judgment].glyph}
                </span>
                {focusPly.san} · {JUDGMENT_META[focusReview.judgment].label}
                {focusReview.bestUci !== focusPly.uci ? ` · melhor era ${focusReview.bestSan}` : ""}
              </p>
              <p className="mx-auto w-full max-w-xl text-sm text-muted">{focusReview.note}</p>
            </>
          ) : null}
          {openingNow ? (
            <p className="mx-auto w-full max-w-xl text-sm text-walnut">
              <span className="font-mono text-xs text-muted">{openingNow.eco}</span>{" "}
              {openingNamePt(openingNow.name)}
              <span className="text-muted"> · {KIND_LABEL[openingNow.kind]}{openingNow.hasGambit && openingNow.kind !== "gambit" ? " com gambito" : ""}</span>
              {book?.leftBookAt != null && cursor >= book.leftBookAt ? (
                <span className="text-muted"> · saiu da teoria no lance {Math.ceil(book.leftBookAt / 2)}</span>
              ) : null}
            </p>
          ) : null}
        </section>

        <aside className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["game", "Partida"],
                ["engine", "Motor"],
                ["review", "Revisão"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className={btn(tab === id)} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "game" && view === "duel" ? (
            <Panel title="Duelo">
              <p className="mb-3 text-sm text-muted">
                Placar {duelScore.w}–{duelScore.d}–{duelScore.b}
                <span className="text-muted"> · brancas, empates, pretas</span>
              </p>
              <div className="flex flex-col gap-4">
                <SeatEditor title="Brancas" seat={whiteBot} onChange={setWhiteBot} />
                <SeatEditor title="Pretas" seat={blackBot} onChange={setBlackBot} />
              </div>
              <p className="mt-4 mb-1 text-sm text-muted" id="pace-label">
                Ritmo
              </p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="pace-label">
                {PACES.map((pace) => (
                  <button key={pace.id} type="button" className={btn(duelPace === pace.id)} onClick={() => setDuelPace(pace.id)}>
                    {pace.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted">
                O ritmo só muda o tempo. No rating alto o motor continua a calcular — não inventa um lance para ser rápido. O texto do lance fica numa linha fixa, então o tabuleiro não desce.
              </p>
              <button type="button" className={`${btn()} mt-3 w-full`} onClick={() => setDuelScore({ w: 0, d: 0, b: 0 })}>
                Zerar placar
              </button>
            </Panel>
          ) : null}

          {tab === "game" && view === "match" ? (
            <Panel title="Partida">
              <p className="mb-2 text-sm text-muted" id="style-label">
                Personalidade
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="style-label">
                {PERSONALITIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={styleId === item.id}
                    className={`${btn(styleId === item.id)} text-left`}
                    onClick={() => setStyleId(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">{personalityById(styleId).blurb}</p>
              <p className="mt-1 text-sm text-muted">
                O estilo só escolhe entre lances que o motor já viu bem. No nível máximo ele joga a linha principal do Stockfish e pensa alguns segundos.
              </p>
              <label className="mt-4 mb-1 block text-sm text-muted" htmlFor="skill">
                Nível {skill} · {levelName(skill)}
                {skill >= 18 ? " · Stockfish pleno" : ""}
              </label>
              <input
                id="skill"
                type="range"
                min={0}
                max={20}
                value={skill}
                onChange={(event) => setSkill(Number(event.target.value))}
                className="w-full accent-walnut"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={btn(mode === "play")}
                  onClick={() => {
                    setMode("play");
                    setAltFor(null);
                    setCursor(plies.length - 1);
                  }}
                >
                  Jogar
                </button>
                <button type="button" className={btn(mode === "analyze")} onClick={() => setMode("analyze")}>
                  Analisar
                </button>
              </div>
              <p className="mt-3 text-sm text-muted">
                {mode === "play"
                  ? `Você joga de ${player === "w" ? "brancas" : "pretas"} contra o perfil ${personalityById(styleId).name}. A barra mostra a avaliação real, não o humor do adversário.`
                  : "No modo análise os dois lados podem ser movidos. As setas do teclado percorrem a partida."}
              </p>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={premoveOn} onChange={(event) => setPremoveOn(event.target.checked)} className="size-5 accent-walnut" />
                Permitir premoves (agendar lances na vez do adversário)
              </label>
              {outcome && atTip ? (
                <button type="button" className={`${btn(true)} mt-3 w-full`} onClick={() => void runReview()} disabled={reviewRunning || plies.length < 2}>
                  Avaliar partida
                </button>
              ) : null}
            </Panel>
          ) : null}

          {tab === "engine" ? (
            <Panel title="Motor">
              <p className="mb-2 text-sm text-muted">
                {reviewRunning ? "O motor está na revisão da partida." : depth > 0 ? `Profundidade ${depth}` : "Aguardando avaliação."}
              </p>
              {lines.length === 0 ? (
                <p className="text-sm text-muted">Sem linhas ainda.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lines.map((line) => (
                    <li key={line.multipv} className="rounded-lg bg-cream px-3 py-2 text-sm">
                      <span className="mr-2 font-mono font-semibold tabular-nums text-ink">
                        {formatEval(toWhiteEval(line.scoreCp, line.mate, new Chess(boardFen).turn()))}
                      </span>
                      <span className="text-ink">{formatPv(boardFen, line.pv) || "…"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {tab === "review" ? (
            <Panel title="Revisão">
              {!reviewRunning ? (
                <div className="mb-3">
                  <label className="mb-1 block text-sm text-muted" htmlFor="review-strength">
                    Força da análise
                  </label>
                  <select
                    id="review-strength"
                    value={strength}
                    onChange={(event) => setStrength(event.target.value as Strength)}
                    className="min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm"
                  >
                    {(Object.keys(STRENGTHS) as Strength[]).map((id) => (
                      <option key={id} value={id}>
                        {STRENGTHS[id].label} · profundidade {STRENGTHS[id].depth}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">
                    {plies.length > 1
                      ? `Até ~${Math.max(1, Math.round((plies.length * STRENGTHS[strength].movetime * 0.6) / 60000))} min para esta partida. Mais fundo mostra erros que a análise rápida deixa passar.`
                      : "Mais fundo mostra erros que a análise rápida deixa passar."}
                  </p>
                </div>
              ) : null}
              {reviewRunning ? (
                <div className="mb-3">
                  <p className="mb-2 text-sm text-ink">
                    Avaliando {activeReview?.progress ?? 0} de {activeReview?.total ?? 0}
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-soft">
                    <div
                      className="h-full bg-walnut transition-[width] duration-300 ease-out"
                      style={{
                        width: `${activeReview && activeReview.total > 0 ? (activeReview.progress / activeReview.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <button type="button" className={`${btn()} mt-3 w-full`} onClick={stopReview}>
                    Parar
                  </button>
                </div>
              ) : (
                activeReview?.partial && activeReview.progress < activeReview.total ? (
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <button type="button" className={btn(true)} onClick={() => void runReview(true)} disabled={enginePhase !== "ready"}>
                      Continuar ({activeReview.progress}/{activeReview.total})
                    </button>
                    <button type="button" className={btn()} onClick={() => void runReview()} disabled={enginePhase !== "ready"}>
                      Refazer
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${btn(true)} mb-3 w-full`}
                    onClick={() => void runReview()}
                    disabled={enginePhase !== "ready" || plies.length < 2}
                  >
                    {activeReview ? "Avaliar de novo" : "Avaliar partida"}
                  </button>
                )
              )}
              {plies.length > 1 ? (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button type="button" className={btn()} onClick={saveAnnotatedPgn}>
                    Salvar PGN anotado
                  </button>
                  <button type="button" className={btn()} onClick={saveAnalysisFile}>
                    Salvar análise
                  </button>
                </div>
              ) : null}
              {activeReview ? <p className="mb-3 text-xs text-muted">A análise fica guardada neste aparelho enquanto o PGN e o FEN forem os mesmos.</p> : null}
              <p className="mb-3 text-sm text-muted">
                Cada lance ganha uma categoria com cor e símbolo, como no Chess.com. A conta usa a chance de vitória, não só os peões. Brilhante exige sacrifício de verdade; Ótimo, um lance que decide e que as alternativas não igualam.
              </p>
              {summary && activeReview && (activeReview.status === "done" || activeReview.progress > 0) ? (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <Stat label="Precisão brancas" value={formatPercent(summary.white)} />
                    <Stat label="Precisão pretas" value={formatPercent(summary.black)} />
                  </div>
                  <ReviewSummary counts={summary.counts} active={focusReview?.judgment ?? null} onJump={jumpToJudgment} />
                </>
              ) : null}
              {focusReview && focusPly?.san ? (
                <div className="mb-3 rounded-lg bg-cream px-3 py-2 text-sm">
                  <p className="font-semibold" style={{ color: judgmentInk(focusReview.judgment) }}>
                    {focusPly.san} · {JUDGMENT_META[focusReview.judgment].label}
                    {focusReview.lossCp > 8 ? ` · −${(focusReview.lossCp / 100).toFixed(1)}` : ""}
                  </p>
                  <p className="mt-1 text-ink">{focusReview.note}</p>
                  <p className="mt-1 text-muted">
                    {formatEval(focusReview.evalBefore)} → {formatEval(focusReview.evalAfter)}
                    {focusReview.bestUci !== focusPly.uci ? ` · melhor era ${focusReview.bestSan}` : ""}
                    {focusReview.forced ? " · lance único" : ""}
                  </p>
                  {focusReview.bestUci !== focusPly.uci ? (
                    <button
                      type="button"
                      className={`${btn(altFor === focusIndex)} mt-2`}
                      onClick={() => {
                        if (altFor === focusIndex) {
                          setAltFor(null);
                          setCursor(focusIndex);
                        } else {
                          setAltFor(focusIndex);
                          setCursor(focusIndex - 1);
                        }
                      }}
                    >
                      {altFor === focusIndex ? "Voltar ao lance" : "Ver alternativa"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel title="Notação">
            <MoveList
              plies={plies}
              rows={rows}
              cursor={focusIndex}
              review={activeReview}
              onPick={(index) => {
                setAltFor(null);
                setCursor(index);
              }}
            />
            <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="import">
              Colar FEN ou PGN
            </label>
            <textarea
              id="import"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              className="min-h-20 w-full rounded-lg border border-line bg-cream p-2 font-mono text-xs"
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" className={btn(true)} onClick={loadPosition}>
                Carregar
              </button>
              <button type="button" className={btn()} onClick={() => void copyText(pgnOf(plies), "PGN")}>
                PGN
              </button>
              <button type="button" className={btn()} onClick={() => void copyText(boardFen, "FEN")}>
                FEN
              </button>
            </div>
            <input
              ref={analysisFileRef}
              type="file"
              accept=".json,.pgn,.txt,.fen"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void openAnalysisFile(file);
              }}
            />
            <button type="button" className={`${btn()} mt-2 w-full`} onClick={() => analysisFileRef.current?.click()}>
              Abrir arquivo (análise, PGN ou FEN)
            </button>
            {notice ? <p className="mt-2 text-sm break-all text-muted">{notice}</p> : null}
          </Panel>
        </aside>
      </div>
      )}
    </main>
  );
}

function btn(active = false) {
  return `min-h-11 rounded-lg px-3 text-sm disabled:opacity-50 ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}

function clampRating(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 1600;
  const stepped = Math.round(value / 100) * 100;
  return Math.max(800, Math.min(2600, stepped));
}

function seatSkill(seat: BotSeat) {
  if (seat.rating >= 2600) return 20;
  return Math.max(0, Math.min(19, Math.round((seat.rating - 800) / 95)));
}

function ratingLabel(rating: number) {
  return rating >= 2600 ? "Força plena" : String(rating);
}

function SeatEditor({ title, seat, onChange }: { title: string; seat: BotSeat; onChange: (seat: BotSeat) => void }) {
  const styleInput = `${title}-estilo`;
  const ratingInput = `${title}-rating`;
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <label className="mt-2 mb-1 block text-sm text-muted" htmlFor={styleInput}>
        Estilo
      </label>
      <select
        id={styleInput}
        value={seat.styleId}
        onChange={(event) => onChange({ ...seat, styleId: personalityById(event.target.value).id })}
        className="min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm"
      >
        {PERSONALITIES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-sm text-muted">{personalityById(seat.styleId).blurb}</p>
      <label className="mt-3 mb-1 block text-sm text-muted" htmlFor={ratingInput}>
        Rating {ratingLabel(seat.rating)}
        {seat.rating >= 2600 ? " · Stockfish pleno" : ` · ${levelName(seatSkill(seat))}`}
      </label>
      <input
        id={ratingInput}
        type="range"
        min={800}
        max={2600}
        step={100}
        value={seat.rating}
        onChange={(event) => onChange({ ...seat, rating: Number(event.target.value) })}
        className="w-full accent-walnut"
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-paper p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cream px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-lg tabular-nums text-ink">{value}</p>
    </div>
  );
}

function MoveList({
  plies,
  rows,
  cursor,
  review,
  onPick,
}: {
  plies: Ply[];
  rows: Array<{ n: number; white?: number; black?: number }>;
  cursor: number;
  review: ReviewState | null;
  onPick: (index: number) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nenhum lance.</p>;
  return (
    <div className="max-h-72 overflow-auto">
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.n} className="flex items-center gap-1">
            <span className="w-8 shrink-0 font-mono text-xs text-muted">{row.n}.</span>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
              <MoveCell index={row.white} plies={plies} cursor={cursor} review={review} onPick={onPick} />
              <MoveCell index={row.black} plies={plies} cursor={cursor} review={review} onPick={onPick} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveCell({
  index,
  plies,
  cursor,
  review,
  onPick,
}: {
  index?: number;
  plies: Ply[];
  cursor: number;
  review: ReviewState | null;
  onPick: (index: number) => void;
}) {
  if (!index) return <span />;
  const ply = plies[index];
  const item = review?.moves[index];
  const meta = item ? JUDGMENT_META[item.judgment] : null;
  const active = cursor === index;
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      className={`flex min-h-11 items-center justify-between gap-1 rounded-lg px-2 text-left text-sm ${active ? "bg-soft text-ink" : "text-ink hover:bg-soft"}`}
    >
      <span>{ply?.san}</span>
      {meta ? (
        <span
          aria-label={meta.label}
          title={meta.label}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] leading-none font-bold text-white"
          style={{ backgroundColor: meta.color }}
        >
          {meta.glyph}
        </span>
      ) : null}
    </button>
  );
}
