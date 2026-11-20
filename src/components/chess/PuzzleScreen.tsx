import { useEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Board, type BoardArrow } from "@/components/chess/Board";
import { PuzzleStream, matchesFilter, type PuzzleFilter } from "@/lib/importers/puzzle-stream";
import { SHAPE_COLORS, toggleShape, type Shape, type ShapeColor } from "@/lib/shapes";
import { kingInCheck } from "@/lib/game";
import {
  BUILTIN_PUZZLES,
  DEFAULT_PROFILE,
  THEME_FILTERS,
  applyResult,
  applyUci,
  isMateFen,
  loadProfile,
  pickFromList,
  saveProfile,
  solverColor,
  themeLabel,
  type Puzzle,
  type PuzzleProfile,
  type ThemeFilter,
} from "@/lib/puzzles";

type Phase = "loading" | "setup" | "user" | "reply" | "solved" | "failed" | "showing";
type Promo = "q" | "r" | "b" | "n";

const PROMO_LABEL: Record<Promo, string> = { q: "Dama", r: "Torre", b: "Bispo", n: "Cavalo" };

/** Puzzles prontos (o atual + a fila) quando se lê o arquivo sob demanda. */
const LAZY_TARGET = 5;
const LAZY_MARK = "byte-chess-lazy-v1";
const MARGIN_KEY = "byte-chess-puzzle-margin-v1";
/** Margens em torno do rating do jogador (0 = sem limite). */
const MARGINS = [100, 200, 300, 500, 800, 0] as const;

type LazyState = {
  stream: PuzzleStream;
  queue: Puzzle[];
  filter: PuzzleFilter;
  busy: Promise<void>;
  abort: AbortController;
};

export function PuzzleScreen() {
  const [profile, setProfile] = useState<PuzzleProfile>(DEFAULT_PROFILE);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState(BUILTIN_PUZZLES[0].fen);
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [promo, setPromo] = useState<{ from: Square; to: Square; color: "w" | "b" } | null>(null);
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [hinted, setHinted] = useState(false);
  const [line, setLine] = useState("Carregando puzzles…");
  const [detail, setDetail] = useState("");
  const [theme, setTheme] = useState<ThemeFilter>("all");
  const [ratingDraft, setRatingDraft] = useState("1000");
  const [autoNext, setAutoNext] = useState(true);
  const [lazyName, setLazyName] = useState("");
  const [lazyNote, setLazyNote] = useState("");
  const [lazyQueue, setLazyQueue] = useState(0);
  const [lazyLines, setLazyLines] = useState(0);
  const [lazyPct, setLazyPct] = useState(0);
  const [margin, setMargin] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(MARGIN_KEY));
      return (MARGINS as readonly number[]).includes(saved) && localStorage.getItem(MARGIN_KEY) !== null ? saved : 300;
    } catch {
      return 300;
    }
  });
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState<ShapeColor>("green");
  const marginRef = useRef(margin);
  const [lazyRestart, setLazyRestart] = useState(false);
  const lazyRef = useRef<LazyState | null>(null);
  const lazyFileRef = useRef<HTMLInputElement>(null);

  const profileRef = useRef(profile);
  const puzzleRef = useRef(puzzle);
  const fenRef = useRef(fen);
  const stepRef = useRef(step);
  const hintedRef = useRef(false);
  const themeRef = useRef(theme);
  marginRef.current = margin;
  profileRef.current = profile;
  puzzleRef.current = puzzle;
  fenRef.current = fen;
  stepRef.current = step;
  themeRef.current = theme;

  function remember(next: PuzzleProfile) {
    profileRef.current = next;
    setProfile(next);
    setRatingDraft(String(next.rating));
    setAutoNext(next.autoNext);
    saveProfile(next);
  }

  function begin(next: Puzzle) {
    const setup = next.moves.length >= 2;
    puzzleRef.current = next;
    setPuzzle(next);
    setFen(next.fen);
    fenRef.current = next.fen;
    setStep(0);
    stepRef.current = 0;
    setPhase(setup ? "setup" : "user");
    setFlipped(solverColor(next) === "b");
    setSelected(null);
    setPromo(null);
    setArrows([]);
    setShapes([]);
    setHintSquare(null);
    setHinted(false);
    hintedRef.current = false;
    setLastMove(null);
    setLine(setup ? "Observe o lance." : turnLine(next));
    setDetail(goalLine(next, 0));
  }

  /** Sem arquivo aberto, sorteia do pacote inicial de mates. */
  function choose(current: PuzzleProfile, filter: ThemeFilter) {
    return pickFromList(BUILTIN_PUZZLES, current.rating, new Set(current.recent), filter);
  }

  /** Faixa de rating = rating atual do jogador ± margem (margem 0 = sem limite). Acompanha o rating a cada puzzle. */
  function currentFilter(): PuzzleFilter {
    const rating = profileRef.current.rating;
    const span = marginRef.current;
    return span === 0 ? { minRating: 0, maxRating: 9999, theme: themeRef.current } : { minRating: Math.max(0, rating - span), maxRating: rating + span, theme: themeRef.current };
  }

  /** Lê do arquivo só o que falta para manter a fila (uma leitura por vez). */
  function lazyTake(state: LazyState, wanted: number) {
    state.busy = state.busy.then(async () => {
      if (state.abort.signal.aborted || state.stream.done) return;
      state.filter = currentFilter();
      const exclude = new Set<string>([...profileRef.current.recent, ...state.queue.map((item) => item.id)]);
      if (puzzleRef.current) exclude.add(puzzleRef.current.id);
      const found = await state.stream.take(wanted, state.filter, exclude, state.abort.signal, (lines) => {
        setLazyLines(lines);
        setLazyPct(state.stream.percent);
      });
      state.queue.push(...found);
      setLazyQueue(state.queue.length);
      setLazyLines(state.stream.linesRead);
      setLazyPct(state.stream.percent);
      try {
        localStorage.setItem(LAZY_MARK, JSON.stringify({ name: state.stream.file.name, size: state.stream.file.size, lines: state.stream.linesRead }));
      } catch {
        /* ignore quota */
      }
    });
    return state.busy;
  }

  /** Repõe a fila: depois de resolver um puzzle, lê mais um para manter os 5 prontos. */
  function lazyRefill(solved: boolean) {
    const state = lazyRef.current;
    if (!state) return;
    const target = solved ? LAZY_TARGET : LAZY_TARGET - 1;
    // O rating mudou: puzzles da fila que saíram da faixa são trocados por outros dentro dela.
    state.filter = currentFilter();
    state.queue = state.queue.filter((item) => matchesFilter(item, state.filter));
    setLazyQueue(state.queue.length);
    const missing = target - state.queue.length;
    if (missing > 0) void lazyTake(state, missing).catch(() => setLazyNote("Não consegui ler mais puzzles do arquivo."));
  }

  function stopLazy(note = "") {
    const state = lazyRef.current;
    if (state) {
      state.abort.abort();
      state.stream.close();
    }
    lazyRef.current = null;
    setLazyName("");
    setLazyQueue(0);
    setLazyNote(note);
  }

  async function startLazy(file: File) {
    stopLazy();
    setLazyNote("Abrindo o arquivo…");
    try {
      let resume = 0;
      try {
        const saved = JSON.parse(localStorage.getItem(LAZY_MARK) ?? "null") as { name?: string; size?: number; lines?: number } | null;
        if (!lazyRestart && saved && saved.name === file.name && saved.size === file.size && typeof saved.lines === "number") resume = saved.lines;
      } catch {
        resume = 0;
      }
      const stream = await PuzzleStream.open(file, resume);
      const state: LazyState = { stream, queue: [], filter: currentFilter(), busy: Promise.resolve(), abort: new AbortController() };
      lazyRef.current = state;
      setLazyName(file.name);
      setLazyNote(resume > 0 ? `Retomando da linha ${resume.toLocaleString("pt-BR")}…` : "Procurando puzzles nos filtros…");
      await lazyTake(state, LAZY_TARGET);
      const first = state.queue.shift();
      setLazyQueue(state.queue.length);
      if (!first) {
        setLazyNote("Nenhum puzzle com esses filtros nesse arquivo.");
        return;
      }
      setLazyNote(`${LAZY_TARGET} puzzles prontos. A cada puzzle resolvido, o app lê mais um.`);
      begin(first);
    } catch (error) {
      lazyRef.current = null;
      setLazyName("");
      setLazyNote(error instanceof Error && error.message ? error.message : "Não consegui abrir esse arquivo.");
    }
  }

  /** Aplica novos filtros: descarta a fila e lê de novo (o puzzle atual continua). */
  function applyLazyFilters() {
    const state = lazyRef.current;
    if (!state) return;
    state.filter = currentFilter();
    state.queue = [];
    setLazyQueue(0);
    setLazyNote("Filtros aplicados. Procurando…");
    lazyRefill(false);
  }

  async function goNext() {
    const lazy = lazyRef.current;
    if (lazy) {
      if (lazy.queue.length === 0) {
        setLine("Procurando o próximo puzzle no arquivo…");
        await lazyTake(lazy, 1);
      }
      const next = lazy.queue.shift();
      setLazyQueue(lazy.queue.length);
      if (next) {
        begin(next);
        lazyRefill(false);
        return;
      }
      setLine("Acabaram os puzzles desse arquivo com esse filtro.");
      setDetail("Troque o filtro, recomece o arquivo ou volte à base local.");
      setPhase("failed");
      return;
    }
    const next = choose(profileRef.current, themeRef.current);
    if (!next) {
      setLine("Nenhum puzzle com esse filtro.");
      setDetail("Abra um arquivo de puzzles para ler sob demanda, ou escolha outro tema.");
      setPhase("failed");
      return;
    }
    begin(next);
  }

  useEffect(() => {
    const saved = loadProfile();
    remember(saved);
    const next = choose(saved, "all");
    if (next) begin(next);
    // Boot once. remember/choose/begin are stable enough for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      const state = lazyRef.current;
      if (state) {
        state.abort.abort();
        state.stream.close();
      }
    },
    [],
  );

  useEffect(() => {
    if (phase !== "setup" || !puzzle || puzzle.moves.length < 2) return;
    const id = window.setTimeout(() => {
      const played = applyUci(puzzle.fen, puzzle.moves[0] ?? "");
      if (!played) {
        setPhase("failed");
        setLine("Esse puzzle está inválido.");
        return;
      }
      setFen(played.fen);
      setLastMove({ from: played.from, to: played.to });
      setStep(1);
      setPhase("user");
      setLine(turnLine(puzzle));
      setDetail(goalLine(puzzle, 1));
    }, 420);
    return () => window.clearTimeout(id);
  }, [phase, puzzle]);

  useEffect(() => {
    if (phase !== "reply" || !puzzle) return;
    const id = window.setTimeout(() => {
      const played = applyUci(fenRef.current, puzzle.moves[stepRef.current] ?? "");
      if (!played) {
        setPhase("failed");
        setLine("A continuação desse puzzle falhou.");
        return;
      }
      const nextStep = stepRef.current + 1;
      setFen(played.fen);
      setLastMove({ from: played.from, to: played.to });
      setStep(nextStep);
      if (nextStep >= puzzle.moves.length || isMateFen(played.fen)) {
        settle(true);
        return;
      }
      setPhase("user");
      setLine(turnLine(puzzle));
      setDetail(goalLine(puzzle, nextStep));
    }, 460);
    return () => window.clearTimeout(id);
  }, [phase, puzzle]);

  useEffect(() => {
    if (phase !== "showing" || !puzzle) return;
    let cancelled = false;
    let timer = 0;
    const run = (currentFen: string, currentStep: number) => {
      if (cancelled || currentStep >= puzzle.moves.length) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const played = applyUci(currentFen, puzzle.moves[currentStep] ?? "");
        if (!played) return;
        setFen(played.fen);
        setLastMove({ from: played.from, to: played.to });
        setStep(currentStep + 1);
        setArrows([]);
        run(played.fen, currentStep + 1);
      }, 560);
    };
    run(fenRef.current, stepRef.current);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, puzzle]);

  useEffect(() => {
    if (phase !== "solved" || !autoNext) return;
    const id = window.setTimeout(() => {
      void goNext();
    }, 1200);
    return () => window.clearTimeout(id);
    // goNext reads refs; autoNext/phase/puzzle identity are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoNext, puzzle?.id]);

  function settle(success: boolean, extra?: string) {
    const currentPuzzle = puzzleRef.current;
    if (!currentPuzzle) return;
    const next = applyResult(profileRef.current, currentPuzzle, success, hintedRef.current);
    const delta = next.rating - profileRef.current.rating;
    const signed = `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`;
    remember(next);
    lazyRefill(true);
    const ratingBit = success
      ? hintedRef.current
        ? `${signed} de rating · a dica não aumenta a sequência`
        : `${signed} de rating · sequência ${next.streak}`
      : `${signed} de rating · sequência zerada`;
    if (success) {
      setPhase("solved");
      setLine("Resolvido.");
      setDetail(extra ? `${extra} ${ratingBit}` : ratingBit);
      setArrows([]);
      return;
    }
    setPhase("failed");
    setLine("Não era esse lance.");
    setDetail(extra ? `${extra} ${ratingBit}` : ratingBit);
  }

  function commit(from: Square, to: Square, promotion?: Promo) {
    const current = puzzleRef.current;
    if (!current || phase !== "user") return;
    const uci = `${from}${to}${promotion ?? ""}`;
    const played = applyUci(fenRef.current, uci);
    if (!played) return;
    const expected = current.moves[stepRef.current] ?? "";
    const mate = isMateFen(played.fen);
    const correct = uci === expected || (mate && uci !== expected);
    setSelected(null);
    setPromo(null);
    setHintSquare(null);
    if (!correct) {
      const solution = applyUci(fenRef.current, expected);
      if (solution) setArrows([{ from: solution.from, to: solution.to, tone: "good" }]);
      settle(false, `O lance era ${solution?.san ?? expected}.`);
      return;
    }
    setFen(played.fen);
    setLastMove({ from: played.from, to: played.to });
    setArrows([]);
    const nextStep = stepRef.current + 1;
    setStep(nextStep);
    if (mate || nextStep >= current.moves.length) {
      settle(true);
      return;
    }
    setPhase("reply");
    setLine("Observe o lance.");
    setDetail(goalLine(current, nextStep));
  }

  function tryMove(from: Square, to: Square) {
    if (phase !== "user") return;
    const options = new Chess(fenRef.current).moves({ square: from, verbose: true }).filter((move) => move.to === to);
    if (options.length === 0) {
      selectSquare(to);
      return;
    }
    const promotions = options.filter((move) => move.promotion);
    if (promotions.length > 1) {
      setPromo({ from, to, color: new Chess(fenRef.current).turn() });
      setSelected(null);
      return;
    }
    commit(from, to, promotions[0]?.promotion as Promo | undefined);
  }

  function selectSquare(square: Square) {
    if (phase !== "user" || !puzzle) return;
    const chess = new Chess(fen);
    if (selected) {
      const legal = chess.moves({ square: selected, verbose: true });
      if (legal.some((move) => move.to === square)) {
        tryMove(selected, square);
        return;
      }
    }
    const piece = chess.get(square);
    if (piece && piece.color === chess.turn() && piece.color === solverColor(puzzle)) {
      setSelected(square);
      return;
    }
    setSelected(null);
  }

  function showHint() {
    const current = puzzleRef.current;
    if (!current || phase !== "user" || hintedRef.current) return;
    const from = current.moves[stepRef.current]?.slice(0, 2) as Square | undefined;
    if (!from) return;
    hintedRef.current = true;
    setHinted(true);
    setHintSquare(from);
    setSelected(from);
    setDetail("Dica: mova a peça marcada. A sequência não sobe.");
  }

  const targets =
    selected && phase === "user"
      ? [...new Set(new Chess(fen).moves({ square: selected, verbose: true }).map((move) => move.to))]
      : [];

  const interactive = phase === "user";
  const solver = puzzle ? solverColor(puzzle) : "w";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex flex-col gap-3">
        <div className="mx-auto w-full max-w-xl">
          <p className="h-5 truncate text-sm text-ink">{line}</p>
          <p className="h-5 truncate text-sm text-walnut" title={detail}>
            {detail}
          </p>
        </div>
        <div className="relative mx-auto w-full max-w-xl">
          <Board
            fen={fen}
            flipped={flipped}
            selected={selected ?? hintSquare}
            targets={targets}
            lastMove={lastMove}
            checkSquare={kingInCheck(fen)}
            arrows={arrows}
            shapes={shapes}
            onShape={(shape) => setShapes((current) => toggleShape(current, shape))}
            onClearShapes={() => setShapes([])}
            drawMode={drawMode}
            drawColor={drawColor}
            interactive={interactive}
            player={solver}
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
        <div className="mx-auto flex w-full max-w-xl flex-wrap gap-2">
          <button type="button" className={btn()} onClick={() => setFlipped((value) => !value)}>
            Virar
          </button>
          <button type="button" className={btn()} onClick={showHint} disabled={phase !== "user" || hinted}>
            Dica
          </button>
          <button
            type="button"
            className={btn()}
            disabled={phase !== "user"}
            onClick={() => {
              const expected = puzzle?.moves[step] ?? "";
              const solution = applyUci(fen, expected);
              if (solution) setArrows([{ from: solution.from, to: solution.to, tone: "good" }]);
              settle(false, solution ? `O lance era ${solution.san}.` : undefined);
              setLine("Você desistiu.");
            }}
          >
            Desistir
          </button>
          {phase === "failed" ? (
            <button type="button" className={btn()} onClick={() => setPhase("showing")}>
              Ver solução
            </button>
          ) : null}
          <button type="button" className={btn(true)} onClick={() => void goNext()} disabled={phase === "loading" || phase === "setup" || phase === "reply"}>
            Próximo
          </button>
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
          {shapes.length > 0 ? (
            <button type="button" className={btn()} onClick={() => setShapes([])}>
              Limpar desenhos
            </button>
          ) : null}
        </div>
        <p className="mx-auto w-full max-w-xl text-xs text-muted">
          Botão direito marca uma casa; arrastar com o direito desenha uma seta (Shift vermelho, Ctrl azul, Alt amarelo). No celular, ligue “Desenhar”. Os desenhos somem no próximo puzzle.
        </p>
      </section>

      <aside className="flex flex-col gap-3">
        <section className="rounded-3xl border border-line bg-paper p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Seu rating</h2>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Rating" value={String(profile.rating)} />
            <Stat label="Sequência" value={String(profile.streak)} />
            <Stat label="Recorde" value={String(profile.best)} />
          </div>
          <p className="mt-3 text-sm text-muted">
            {profile.solved} certos · {profile.failed} erros. Acertar sobe o rating conforme a dificuldade. Errar zera a sequência.
          </p>
          <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="puzzle-rating">
            Ajustar rating
          </label>
          <input
            id="puzzle-rating"
            inputMode="numeric"
            value={ratingDraft}
            onChange={(event) => setRatingDraft(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            onBlur={() => {
              const rating = Math.max(400, Math.min(2800, Math.round(Number(ratingDraft) || profileRef.current.rating)));
              remember({ ...profileRef.current, rating });
            }}
            className="min-h-11 w-full rounded-lg border border-line bg-cream px-3 font-mono text-sm"
          />
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(event) => {
                setAutoNext(event.target.checked);
                remember({ ...profileRef.current, autoNext: event.target.checked });
              }}
            />
            Próximo automático depois de um acerto
          </label>
        </section>

        <section className="rounded-3xl border border-line bg-paper p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Puzzles</h2>
          <p className="text-sm text-muted">
            {lazyName
              ? "Lendo o arquivo sob demanda: o app procura só os puzzles dos filtros e lê mais um a cada puzzle resolvido."
              : "Pacote inicial de mates. Abra um arquivo (CSV da Lichess, .zst, .gz ou .db) para ler sob demanda, sem importar nada."}
          </p>
          {puzzle && puzzle.themes.length > 0 ? (
            <p className="mt-2 text-sm text-ink">{puzzle.themes.slice(0, 3).map(themeLabel).join(" · ")} · {puzzle.rating}</p>
          ) : null}
          <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="puzzle-theme">
            Tema do próximo
          </label>
          <select
            id="puzzle-theme"
            value={theme}
            onChange={(event) => {
              const next = event.target.value as ThemeFilter;
              themeRef.current = next;
              setTheme(next);
              applyLazyFilters();
            }}
            className="min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm"
          >
            {THEME_FILTERS.map((item) => (
              <option key={item} value={item}>
                {themeLabel(item)}
              </option>
            ))}
          </select>
          <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="puzzle-margin">
            Dificuldade: margem em torno do seu rating
          </label>
          <select
            id="puzzle-margin"
            value={margin}
            onChange={(event) => {
              const next = Number(event.target.value);
              marginRef.current = next;
              setMargin(next);
              try {
                localStorage.setItem(MARGIN_KEY, String(next));
              } catch {
                /* ignore quota */
              }
              applyLazyFilters();
            }}
            className="min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm"
          >
            {MARGINS.map((value) => (
              <option key={value} value={value}>
                {value === 0 ? "Sem limite" : `± ${value}`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            {margin === 0
              ? "Qualquer rating."
              : `Faixa agora: ${Math.max(0, profile.rating - margin)} a ${profile.rating + margin}. Acompanha o seu rating conforme você resolve.`}
          </p>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={lazyRestart} onChange={(event) => setLazyRestart(event.target.checked)} className="size-5 accent-walnut" />
            Recomeçar do início (senão retoma de onde parou)
          </label>
          <input
            ref={lazyFileRef}
            type="file"
            accept=".csv,.tsv,.json,.txt,.zst,.gz,.db,.sqlite,.sqlite3"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void startLazy(file);
            }}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className={btn(true)} onClick={() => lazyFileRef.current?.click()}>
              {lazyName ? "Trocar arquivo" : "Abrir arquivo"}
            </button>
            <button type="button" className={btn()} onClick={() => void goNext()} disabled={phase === "setup" || phase === "reply"}>
              Sortear
            </button>
            <button type="button" className={btn()} onClick={downloadSample}>
              Exemplo CSV
            </button>
            {lazyName ? (
              <button type="button" className={`${btn()} col-span-2`} onClick={() => stopLazy("Arquivo fechado. Voltamos ao pacote inicial.")}>
                Fechar arquivo
              </button>
            ) : null}
          </div>
          {lazyName ? (
            <p className="mt-3 text-sm text-ink">
              {lazyName} · {lazyQueue} na fila · {lazyLines.toLocaleString("pt-BR")} linhas lidas ({Math.round(lazyPct)}% do arquivo)
            </p>
          ) : null}
          {lazyNote ? <p className="mt-2 text-sm text-muted">{lazyNote}</p> : null}
          <p className="mt-3 text-xs text-muted">O primeiro lance do puzzle é do adversário; você responde em seguida. Arquivos .db são lidos inteiros na memória (até 1,5 GB).</p>
        </section>
      </aside>
    </div>
  );
}

function turnLine(puzzle: Puzzle) {
  return solverColor(puzzle) === "w" ? "Sua vez, com as brancas." : "Sua vez, com as pretas.";
}

function goalLine(puzzle: Puzzle, step: number) {
  const start = puzzle.moves.length >= 2 ? 1 : 0;
  const total = Math.max(1, Math.ceil((puzzle.moves.length - start) / 2));
  const index = Math.min(total, Math.floor((Math.max(step, start) - start) / 2) + 1);
  const kind = puzzle.themes.includes("mate") ? "Dê o mate" : "Encontre a continuação";
  return total > 1 ? `${kind} · lance ${index} de ${total}` : kind;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cream px-2 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-lg tabular-nums text-ink">{value}</p>
    </div>
  );
}

function btn(active = false) {
  return `min-h-11 rounded-lg px-3 text-sm disabled:opacity-50 ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}

function downloadSample() {
  const header = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
  const lines = BUILTIN_PUZZLES.map((puzzle) =>
    [puzzle.id, puzzle.fen, puzzle.moves.join(" "), puzzle.rating, 80, 90, 20, puzzle.themes.join(" "), "", ""].join(","),
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "puzzles-exemplo.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
