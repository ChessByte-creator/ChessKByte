import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearGames, countGames, deleteSource, listSources, searchGames, topFamilies, type GameFilters, type GameRecord, type GameResult, type SourceInfo } from "@/lib/games-db";
import { importGameFile } from "@/lib/importers/game-import";
import { openGameSource, type GameSource } from "@/lib/importers/game-source";
import { clearRepoSession, repoSession } from "@/lib/repo-session";
import { pliesFromSan, type Ply } from "@/lib/game";
import { infoFromRecord, type GameInfo } from "@/lib/game-info";
import { KIND_LABEL, openingNamePt, type OpeningKind, type OpeningsIndex } from "@/lib/openings";
import { norm, saveRecent, tokenLabel, tokensToFilters, type Token } from "@/lib/search-tokens";
import { SearchBox } from "@/components/chess/SearchBox";

type Props = {
  openings: OpeningsIndex | null;
  onOpen: (plies: Ply[], at?: "start" | "end", info?: GameInfo | null) => void;
  /** Verdadeiro enquanto a aba Repositório está visível (a tela fica montada, só escondida). */
  active?: boolean;
};

type Mode = "file" | "local";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const RESULT_LABEL: Record<GameResult, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "*" };

const KIND_CHIPS: Array<{ id: OpeningKind | "gambit" | "all"; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "opening", label: "Aberturas" },
  { id: "defense", label: "Defesas" },
  { id: "gambit", label: "Gambitos" },
];
const RESULT_CHIPS: Array<{ id: GameResult | "all"; label: string }> = [
  { id: "all", label: "Qualquer" },
  { id: "1-0", label: "Brancas" },
  { id: "1/2-1/2", label: "Empate" },
  { id: "0-1", label: "Pretas" },
];
/** Faixas prontas de rating do jogador mais forte (mínimo e máximo, 0 = sem limite). */
const ELO_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "Qualquer", min: 0, max: 0 },
  { label: "Até 1000", min: 0, max: 1000 },
  { label: "1000–1400", min: 1000, max: 1400 },
  { label: "1400–1800", min: 1400, max: 1800 },
  { label: "1800–2200", min: 1800, max: 2200 },
  { label: "2200+", min: 2200, max: 0 },
];
const OUTCOME_CHIPS: Array<{ id: "all" | "win" | "draw" | "loss"; label: string }> = [
  { id: "all", label: "Qualquer" },
  { id: "win", label: "Vitórias dele" },
  { id: "draw", label: "Empates" },
  { id: "loss", label: "Derrotas dele" },
];
const SIDE_CHIPS: Array<{ id: "any" | "white" | "black"; label: string }> = [
  { id: "any", label: "Qualquer cor" },
  { id: "white", label: "De brancas" },
  { id: "black", label: "De pretas" },
];

export function RepositoryScreen({ openings, onOpen, active = true }: Props) {
  const [mode, setMode] = useState<Mode>(repoSession.mode);
  const [pageSize, setPageSize] = useState<number>(repoSession.pageSize);

  // filtros: o que está nos campos (rascunho) e o que foi aplicado na última busca
  const [tokens, setTokens] = useState<Token[]>(repoSession.draft?.tokens ?? []);
  const [appliedTokens, setAppliedTokens] = useState<Token[]>(repoSession.draft?.appliedTokens ?? []);
  const [side, setSide] = useState<"any" | "white" | "black">(repoSession.draft?.side ?? "any");
  const [outcome, setOutcome] = useState<"all" | "win" | "draw" | "loss">(repoSession.draft?.outcome ?? "all");
  const [playerTotal, setPlayerTotal] = useState<number | null>(null);
  const [filtersVersion, setFiltersVersion] = useState(0);
  const [coarse, setCoarse] = useState(false);
  const mounted = useRef(false);
  const [kind, setKind] = useState<OpeningKind | "gambit" | "all">(repoSession.draft?.kind ?? "all");
  const [result, setResult] = useState<GameResult | "all">(repoSession.draft?.result ?? "all");
  const [family, setFamily] = useState(repoSession.draft?.family ?? "");
  const [elo, setElo] = useState(repoSession.draft?.elo ?? 0);
  const [eloMax, setEloMax] = useState(repoSession.draft?.eloMax ?? 0);
  const [yearFrom, setYearFrom] = useState(repoSession.draft?.yearFrom ?? "");
  const [yearTo, setYearTo] = useState(repoSession.draft?.yearTo ?? "");
  const [source, setSource] = useState(repoSession.draft?.source ?? "");

  const [note, setNote] = useState(repoSession.note);
  const [pageIdx, setPageIdx] = useState(repoSession.pageIdx);
  const [pages, setPages] = useState<GameRecord[][]>(repoSession.pages);
  const [moreAhead, setMoreAhead] = useState(repoSession.moreAhead);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState({ scanned: 0, pct: 0 });
  const [live, setLive] = useState<GameRecord[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(repoSession.pages.length === 0);
  const [opened, setOpened] = useState<GameRecord | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const firstPage = useRef(true);

  // arquivo aberto sob demanda
  const [fileInfo, setFileInfo] = useState<{ name: string; format: string } | null>(repoSession.fileInfo);
  const streamRef = useRef<GameSource | null>(repoSession.source);
  const bufferRef = useRef<GameRecord[]>(repoSession.buffer);
  const pagesRef = useRef<GameRecord[][]>(repoSession.pages);
  const appliedRef = useRef<GameFilters>(repoSession.applied);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // repositório local (importado para o aparelho)
  const [total, setTotal] = useState<number | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [families, setFamilies] = useState<Array<{ family: string; games: number }>>([]);
  const [importing, setImporting] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [maxGames, setMaxGames] = useState(0);
  const [minElo, setMinElo] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const localSeq = useRef(0);

  function currentFilters(): GameFilters {
    const hasPlayer = tokens.some((token) => token.kind === "player");
    return {
      ...tokensToFilters(tokens),
      playerSide: hasPlayer && side !== "any" ? side : undefined,
      outcome: hasPlayer && outcome !== "all" ? outcome : undefined,
      kind,
      result: hasPlayer ? "all" : result,
      family: mode === "local" ? family || undefined : undefined,
      minElo: elo || undefined,
      maxElo: eloMax || undefined,
      yearFrom: Number(yearFrom) || undefined,
      yearTo: Number(yearTo) || undefined,
      source: mode === "local" ? source || undefined : undefined,
    };
  }

  const refreshMeta = useCallback(async () => {
    try {
      setTotal(await countGames());
      setSources(await listSources());
      setFamilies(await topFamilies());
    } catch {
      setTotal(0);
    }
  }, []);

  // Valores mais recentes, para guardar na sessão quando a tela é desmontada.
  const latest = useRef({ mode, pageSize, fileInfo, pageIdx, moreAhead, note, tokens, appliedTokens, side, outcome, kind, result, family, elo, eloMax, yearFrom, yearTo, source });
  latest.current = { mode, pageSize, fileInfo, pageIdx, moreAhead, note, tokens, appliedTokens, side, outcome, kind, result, family, elo, eloMax, yearFrom, yearTo, source };

  useEffect(() => {
    void refreshMeta();
    return () => {
      abortRef.current?.abort();
      importAbort.current?.abort();
      // O arquivo aberto NÃO é fechado: ao voltar para esta tela, a busca continua de onde parou.
      const l = latest.current;
      repoSession.mode = l.mode;
      repoSession.pageSize = l.pageSize;
      repoSession.source = streamRef.current;
      repoSession.fileInfo = l.fileInfo;
      repoSession.pages = pagesRef.current;
      repoSession.buffer = bufferRef.current;
      repoSession.pageIdx = l.pageIdx;
      repoSession.moreAhead = l.moreAhead;
      repoSession.applied = appliedRef.current;
      repoSession.note = l.note;
      repoSession.draft = { tokens: l.tokens, appliedTokens: l.appliedTokens, side: l.side, outcome: l.outcome, kind: l.kind, result: l.result, family: l.family, elo: l.elo, eloMax: l.eloMax, yearFrom: l.yearFrom, yearTo: l.yearTo, source: l.source };
    };
  }, [refreshMeta]);

  // Celular: o seletor de arquivos filtrado por extensão esconde formatos que o Android não conhece (como .db3).
  useEffect(() => {
    setCoarse(typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Escolher uma etiqueta ou um chip já refaz a busca (sem precisar achar o botão lá embaixo no celular).
  const bump = () => setFiltersVersion((value) => value + 1);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (filtersVersion === 0) return;
    if (mode === "file" ? !streamRef.current : !total) return;
    const timer = window.setTimeout(() => search(pageSize, mode, false), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersVersion]);

  // Ao trocar de página, volta ao topo da lista (senão o jogador fica no fim da página nova, sem ver nada).
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) listRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pageIdx]);

  // Ao voltar para esta aba, mostra de novo a partida que estava aberta.
  useEffect(() => {
    if (!active || !opened) return;
    const index = pages[pageIdx]?.indexOf(opened) ?? -1;
    if (index < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)?.scrollIntoView({ block: "center" });
  }, [active, opened, pages, pageIdx]);

  function resetResults() {
    abortRef.current?.abort();
    pagesRef.current = [];
    bufferRef.current = [];
    setPages([]);
    setPageIdx(0);
    setMoreAhead(false);
    setNote("");
  }

  /** Página do arquivo: lê só X partidas (+1 de antecipação para saber se há próxima). */
  async function loadFilePage(index: number, size: number) {
    const stream = streamRef.current;
    if (!stream) return;
    if (pagesRef.current[index]) {
      setPageIdx(index);
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setNote("");
    setLive([...bufferRef.current]);
    try {
      const need = size + 1 - bufferRef.current.length;
      if (need > 0 && !stream.done) {
        const found = await stream.take(
          need,
          appliedRef.current,
          abort.signal,
          (scanned, percent) => setScan({ scanned, pct: percent }),
          (rows) => setLive((current) => [...current, ...rows]),
        );
        bufferRef.current.push(...found);
      }
      if (abort.signal.aborted) {
        setNote("Busca interrompida. Use “Próxima” para continuar de onde parou.");
        return;
      }
      const page = bufferRef.current.splice(0, size);
      if (page.length === 0) {
        setNote(index === 0 ? "Nenhuma partida com esses filtros nesse arquivo." : "Fim do arquivo: não há mais partidas com esses filtros.");
        setMoreAhead(false);
        return;
      }
      pagesRef.current[index] = page;
      setPages([...pagesRef.current]);
      setPageIdx(index);
      setMoreAhead(bufferRef.current.length > 0);
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "Não consegui ler o arquivo.");
    } finally {
      setBusy(false);
      setLive([]);
    }
  }

  /** Página do repositório local: consulta o índice com os filtros e pula `index * X` resultados. */
  async function loadLocalPage(index: number, size: number) {
    const seq = ++localSeq.current;
    setBusy(true);
    setNote("");
    try {
      const found = await searchGames(appliedRef.current, index * size, size);
      if (seq !== localSeq.current) return;
      pagesRef.current[index] = found.rows;
      setPages([...pagesRef.current]);
      setPageIdx(index);
      setMoreAhead(found.hasMore);
      if (found.rows.length === 0) setNote(index === 0 ? "Nenhuma partida com esses filtros." : "Não há mais partidas.");
      else if (found.truncated) setNote("A busca parou depois de 400 mil registros. Refine os filtros para ver mais.");
    } catch {
      if (seq === localSeq.current) setNote("Não consegui consultar o repositório.");
    } finally {
      if (seq === localSeq.current) setBusy(false);
    }
  }

  /** Aplica os filtros dos campos e volta para a página 1 (no arquivo, recomeça a leitura do início). */
  function search(size = pageSize, nextMode = mode, collapse = true) {
    if (collapse) setFiltersOpen(false);
    resetResults();
    appliedRef.current = { ...currentFilters(), family: nextMode === "local" ? family || undefined : undefined, source: nextMode === "local" ? source || undefined : undefined };
    setAppliedTokens(tokens);
    saveRecent(tokens);
    setPlayerTotal(null);
    if (nextMode === "file" && appliedRef.current.player && streamRef.current?.playerCount) {
      const snapshot = appliedRef.current;
      void streamRef.current.playerCount(snapshot).then(
        (count) => {
          if (appliedRef.current === snapshot) setPlayerTotal(count);
        },
        () => undefined,
      );
    }
    if (nextMode === "file") {
      if (!streamRef.current) {
        setNote("Abra um arquivo de partidas para começar.");
        return;
      }
      streamRef.current.restart();
      void loadFilePage(0, size);
    } else {
      if (!total) {
        setNote("O repositório local está vazio. Importe um arquivo ou use o arquivo sob demanda.");
        return;
      }
      void loadLocalPage(0, size);
    }
  }

  function goNext() {
    if (busy) return;
    if (mode === "file") void loadFilePage(pageIdx + 1, pageSize);
    else void loadLocalPage(pageIdx + 1, pageSize);
  }

  function goPrev() {
    if (busy || pageIdx === 0) return;
    if (mode === "file") setPageIdx(pageIdx - 1);
    else void loadLocalPage(pageIdx - 1, pageSize);
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    resetResults();
    setMode(next);
    if (next === "local") void refreshMeta();
  }

  async function openSourceFile(picked: File[]) {
    // O En Croissant guarda o banco em 2 arquivos (.db3 e .ecsi). Só o .db3 é lido; o .ecsi é o índice de posições.
    const file = picked.find((item) => !/\.ecsi$/i.test(item.name)) ?? picked[0];
    if (!file) return;
    abortRef.current?.abort();
    clearRepoSession();
    streamRef.current = null;
    setFileInfo(null);
    resetResults();
    setNote("Abrindo o arquivo…");
    try {
      const opened = await openGameSource(file, openings);
      streamRef.current = opened.source;
      setFileInfo({ name: file.name, format: opened.label });
      search(pageSize, "file", false);
      if (opened.warning) setNote(opened.warning);
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "Não consegui abrir esse arquivo.");
    }
  }

  function closeSourceFile() {
    abortRef.current?.abort();
    clearRepoSession();
    streamRef.current = null;
    setFileInfo(null);
    resetResults();
  }

  /** Abre a partida na análise. Nos bancos do En Croissant os lances são decodificados só agora. */
  async function openGame(game: GameRecord) {
    const source = streamRef.current;
    if (game.ecId != null && source?.loadPlies) {
      try {
        const plies = await source.loadPlies(game);
        if (plies && plies.length > 1) {
          setOpened(game);
          onOpen(plies, "start", infoFromRecord(game));
          return;
        }
      } catch {
        /* cai na mensagem abaixo */
      }
      setNote("Não consegui decodificar os lances dessa partida.");
      return;
    }
    setOpened(game);
    onOpen(pliesFromSan(game.moves), "start", infoFromRecord(game));
  }

  async function importFile(file: File) {
    const abort = new AbortController();
    importAbort.current = abort;
    setImporting(true);
    setConfirmClear(false);
    setPct(0);
    setNote("Lendo o arquivo…");
    try {
      const outcome = await importGameFile(file, {
        openings,
        source: file.name,
        maxGames,
        minElo,
        signal: abort.signal,
        onProgress: ({ added, percent, phase }) => {
          setPct(percent);
          setNote(`${phase} ${added.toLocaleString("pt-BR")} partidas`);
        },
      });
      const cut = abort.signal.aborted ? " (cancelado, o que já entrou foi mantido)" : outcome.stopped ? " (parou no limite escolhido)" : "";
      setNote(
        outcome.added > 0
          ? `${outcome.added.toLocaleString("pt-BR")} partidas importadas${outcome.skipped ? ` · ${outcome.skipped.toLocaleString("pt-BR")} ignoradas` : ""}${cut}.`
          : "Não reconheci partidas nesse arquivo.",
      );
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "Não consegui importar esse arquivo.");
    } finally {
      importAbort.current = null;
      setPct(null);
      setImporting(false);
      await refreshMeta();
    }
  }

  const showingLive = busy && !pages[pageIdx];
  const rows = pages[pageIdx] ?? (showingLive ? live.slice(0, pageSize) : []);
  const hasNext = pageIdx < pages.length - 1 || moreAhead;

  const applied = appliedRef.current;
  // Estável entre renders (a caixa de busca refaz a consulta se esta função mudar). Muda só ao abrir outro arquivo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestPlayers = useMemo(() => streamRef.current?.suggestPlayers?.bind(streamRef.current), [fileInfo]);

  const hasPlayerToken = tokens.some((token) => token.kind === "player");
  const summary = [
    ...appliedTokens.map(tokenLabel),
    applied.playerSide ? (applied.playerSide === "white" ? "De brancas" : "De pretas") : "",
    applied.outcome ? OUTCOME_CHIPS.find((chip) => chip.id === applied.outcome)?.label ?? "" : "",
    applied.kind && applied.kind !== "all" ? KIND_CHIPS.find((chip) => chip.id === applied.kind)?.label ?? "" : "",
    applied.result && applied.result !== "all" ? RESULT_CHIPS.find((chip) => chip.id === applied.result)?.label ?? "" : "",
    applied.minElo || applied.maxElo ? (applied.minElo && applied.maxElo ? `rating ${applied.minElo}–${applied.maxElo}` : applied.minElo ? `rating ${applied.minElo}+` : `rating até ${applied.maxElo}`) : "",
    applied.yearFrom || applied.yearTo ? `${applied.yearFrom ?? ""}–${applied.yearTo ?? ""}` : "",
  ].filter(Boolean);

  /** Do ponto de vista do jogador buscado: venceu, perdeu ou empatou (null se não der para saber). */
  const query = applied.player ? norm(applied.player) : "";
  function perspective(game: GameRecord): "win" | "loss" | "draw" | null {
    if (!query || game.result === "*") return null;
    const white = norm(game.white).includes(query);
    const black = norm(game.black).includes(query);
    const asWhite = white && applied.playerSide !== "black";
    const asBlack = black && applied.playerSide !== "white";
    if (!asWhite && !asBlack) return null;
    if (game.result === "1/2-1/2") return "draw";
    return (game.result === "1-0") === asWhite ? "win" : "loss";
  }

  function clearFilters() {
    setTokens([]);
    setSide("any");
    setOutcome("all");
    setKind("all");
    setResult("all");
    setFamily("");
    setElo(0);
    setEloMax(0);
    setYearFrom("");
    setYearTo("");
    setSource("");
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5">
      <section className="order-2 min-w-0 rounded-3xl border border-line bg-paper p-3 sm:p-4 lg:order-1">
        <h2 className="text-sm font-semibold text-ink">Buscar partidas</h2>
        <p className="mt-1 text-sm text-muted">
          {mode === "file"
            ? fileInfo
              ? `Lendo ${fileInfo.name} sob demanda.`
              : "Abra um arquivo de partidas. Nada é importado: o app lê só o que a página pede."
            : total == null
              ? "Abrindo o repositório local…"
              : total === 0
                ? "O repositório local está vazio. Importe um arquivo."
                : `${total.toLocaleString("pt-BR")} partidas guardadas neste aparelho.`}
        </p>

        {/* Celular: filtros recolhidos depois da busca, para a lista ficar no topo. */}
        {!filtersOpen ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 lg:hidden">
            {summary.length === 0 ? <span className="text-sm text-muted">Sem filtros</span> : summary.map((item) => <span key={item} className="rounded-full bg-soft px-3 py-1 text-xs text-ink">{item}</span>)}
            <button type="button" className="ml-auto min-h-11 rounded-lg border border-line bg-paper px-3 text-sm text-ink" onClick={() => setFiltersOpen(true)}>
              Editar filtros
            </button>
          </div>
        ) : null}

        <form
          className={`mt-3 ${filtersOpen ? "block" : "hidden lg:block"}`}
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <SearchBox tokens={tokens} onChange={(next) => { setTokens(next); bump(); }} openings={openings} suggestPlayers={suggestPlayers} onSubmit={() => search()} />

          {hasPlayerToken ? (
            <>
              <ChipRow label="Cor do jogador">
                {SIDE_CHIPS.map((item) => (
                  <button key={item.id} type="button" aria-pressed={side === item.id} className={chip(side === item.id)} onClick={() => { setSide(item.id); bump(); }}>
                    {item.label}
                  </button>
                ))}
              </ChipRow>
              <ChipRow label="Resultado dele">
                {OUTCOME_CHIPS.map((item) => (
                  <button key={item.id} type="button" aria-pressed={outcome === item.id} className={chip(outcome === item.id)} onClick={() => { setOutcome(item.id); bump(); }}>
                    {item.label}
                  </button>
                ))}
              </ChipRow>
            </>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="submit" className={btn(true)} disabled={busy}>
              {pages.length > 0 ? "Ver resultados" : "Buscar"}
            </button>
            <button type="button" className={btn()} onClick={clearFilters} disabled={busy}>
              Limpar filtros
            </button>
          </div>

          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink">Mais filtros (tipo, rating, ano…)</summary>
          <ChipRow label="Tipo">
            {KIND_CHIPS.map((item) => (
              <button key={item.id} type="button" aria-pressed={kind === item.id} className={chip(kind === item.id)} onClick={() => { setKind(item.id); bump(); }}>
                {item.label}
              </button>
            ))}
          </ChipRow>
          {hasPlayerToken ? null : (
            <ChipRow label="Quem venceu">
              {RESULT_CHIPS.map((item) => (
                <button key={item.id} type="button" aria-pressed={result === item.id} className={chip(result === item.id)} onClick={() => { setResult(item.id); bump(); }}>
                  {item.label}
                </button>
              ))}
            </ChipRow>
          )}
          <ChipRow label="Rating do jogador mais forte da partida">
            {ELO_BANDS.map((band) => {
              const on = elo === band.min && eloMax === band.max;
              return (
                <button key={band.label} type="button" aria-pressed={on} className={chip(on)} onClick={() => { setElo(band.min); setEloMax(band.max); bump(); }}>
                  {band.label}
                </button>
              );
            })}
          </ChipRow>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
            <Field label="Rating de (mínimo)" id="repo-elomin">
              <input id="repo-elomin" inputMode="numeric" placeholder="ex.: 800" value={elo || ""} onChange={(event) => { setElo(Number(event.target.value.replace(/\D/g, "").slice(0, 4)) || 0); bump(); }} className={input()} />
            </Field>
            <Field label="até (máximo)" id="repo-elomax">
              <input id="repo-elomax" inputMode="numeric" placeholder="ex.: 1200" value={eloMax || ""} onChange={(event) => { setEloMax(Number(event.target.value.replace(/\D/g, "").slice(0, 4)) || 0); bump(); }} className={input()} />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">O limite vale para o jogador mais forte: com máximo 1200, os dois ficam em 1200 ou menos. Partidas sem rating não aparecem quando há máximo.</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Ano de" id="repo-from">
                <input id="repo-from" inputMode="numeric" value={yearFrom} onChange={(event) => setYearFrom(event.target.value.replace(/\D/g, "").slice(0, 4))} className={input()} />
              </Field>
              <Field label="Ano até" id="repo-to">
                <input id="repo-to" inputMode="numeric" value={yearTo} onChange={(event) => setYearTo(event.target.value.replace(/\D/g, "").slice(0, 4))} className={input()} />
              </Field>
            </div>
            <Field label="Partidas por página" id="repo-size">
              <select
                id="repo-size"
                value={pageSize}
                onChange={(event) => {
                  const size = Number(event.target.value);
                  setPageSize(size);
                  if (pages.length > 0) search(size);
                }}
                className={input()}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </Field>
            {mode === "local" && sources.length > 1 ? (
              <Field label="Arquivo de origem" id="repo-source">
                <select id="repo-source" value={source} onChange={(event) => setSource(event.target.value)} className={input()}>
                  <option value="">Todos</option>
                  {sources.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} ({item.games.toLocaleString("pt-BR")})
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          {mode === "local" && families.length > 0 ? (
            <ChipRow label="Famílias mais comuns">
              {families.slice(0, 16).map((item) => (
                <button key={item.family} type="button" aria-pressed={family === item.family} className={chip(family === item.family)} onClick={() => setFamily(family === item.family ? "" : item.family)}>
                  {openingNamePt(item.family)} · {item.games.toLocaleString("pt-BR")}
                </button>
              ))}
            </ChipRow>
          ) : null}

          </details>
        </form>

        {busy ? (
          <div className="mt-3 rounded-lg bg-cream px-3 py-2 text-sm text-ink" role="status">
            <div className="flex items-center justify-between gap-3">
              <span>
                {mode === "file"
                  ? `Procurando… ${scan.scanned.toLocaleString("pt-BR")} partidas lidas (${Math.round(scan.pct)}%) · ${live.length} achadas`
                  : "Buscando…"}
              </span>
              <button type="button" className="min-h-11 shrink-0 rounded-lg border border-line bg-paper px-3 text-sm" onClick={() => abortRef.current?.abort()}>
                Parar
              </button>
            </div>
            {mode === "file" ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft">
                <div className="h-full bg-walnut transition-[width] duration-300" style={{ width: `${Math.max(2, scan.pct)}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        {note ? <p className="mt-3 text-sm text-ink">{note}</p> : null}

        {applied.player && pages.length + live.length > 0 ? (
          <div className="mt-3 rounded-lg bg-cream px-3 py-2 text-sm text-ink">
            <p>
              Partidas de <span className="font-medium">{applied.player}</span>
              {applied.opponent ? (
                <>
                  {" "}contra <span className="font-medium">{applied.opponent}</span>
                </>
              ) : null}
              {playerTotal != null && !applied.opponent && !applied.outcome && !applied.ecoIn ? <span className="text-muted"> · {playerTotal.toLocaleString("pt-BR")} no banco</span> : null}
            </p>
            {mode === "file" && streamRef.current?.suggestPlayers && !streamRef.current.playerIndexed ? (
              <p className="mt-1 text-xs text-muted">Este banco não tem índice de jogadores, então a busca varre o arquivo. No En Croissant, use “criar índices” no banco para ficar instantâneo.</p>
            ) : null}
          </div>
        ) : null}

        <ul ref={listRef} className="mt-3 flex min-h-[55vh] flex-col gap-2 scroll-mt-2" aria-busy={busy}>
          {rows.map((game, index) => {
            const isOpened = opened === game;
            return (
              <li key={`${pageIdx}-${index}`} data-row={index}>
                <button
                  type="button"
                  onClick={() => void openGame(game)}
                  className={`min-h-14 w-full rounded-lg px-3 py-2 text-left text-sm ${isOpened ? "bg-soft ring-2 ring-walnut" : "bg-cream hover:bg-soft"} ${busy && !showingLive ? "opacity-60" : ""}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-ink">
                      <span className="block truncate">
                        {game.white}
                        {game.whiteElo ? <span className="text-muted"> ({game.whiteElo})</span> : null}
                      </span>
                      <span className="block truncate">
                        <span className="text-muted">× </span>
                        {game.black}
                        {game.blackElo ? <span className="text-muted"> ({game.blackElo})</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-xs text-ink">{RESULT_LABEL[game.result]}</span>
                      {(() => {
                        const view = perspective(game);
                        return view ? <span className={`block text-xs ${view === "win" ? "text-emerald-700" : view === "loss" ? "text-rose-700" : "text-muted"}`}>{view === "win" ? "venceu" : view === "loss" ? "perdeu" : "empatou"}</span> : null;
                      })()}
                      {isOpened ? <span className="block text-xs text-walnut">aberta</span> : null}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted">
                    {game.eco ? `${game.eco} · ` : ""}
                    {game.opening ? openingNamePt(game.opening) : "Abertura não identificada"} · {KIND_LABEL[game.kind]} · {Math.ceil(game.plies / 2)} lances
                    {game.year ? ` · ${game.year}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {pages.length > 0 ? (
          <nav
            className="sticky bottom-2 z-10 mt-3 flex items-center justify-between gap-2 rounded-2xl border border-line bg-paper/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur"
            aria-label="Páginas"
          >
            <button type="button" className={`${btn()} flex-1`} onClick={goPrev} disabled={busy || pageIdx === 0}>
              ← Anterior
            </button>
            <span className="min-w-16 text-center text-sm text-muted">Pág. {pageIdx + 1}</span>
            <button type="button" className={`${btn(true)} flex-1`} onClick={goNext} disabled={busy || !hasNext}>
              Próxima →
            </button>
          </nav>
        ) : null}
      </section>

      <aside className="order-1 flex flex-col gap-3 lg:order-2">
        <section className="rounded-3xl border border-line bg-paper p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Fonte das partidas</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Fonte">
            <button type="button" className={btn(mode === "file")} aria-pressed={mode === "file"} onClick={() => changeMode("file")}>
              Arquivo
            </button>
            <button type="button" className={btn(mode === "local")} aria-pressed={mode === "local"} onClick={() => changeMode("local")}>
              No aparelho
            </button>
          </div>

          {mode === "file" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={coarse ? undefined : ".pgn,.txt,.zst,.gz,.db,.db3,.ecsi,.sqlite,.sqlite3"}
                multiple
                className="sr-only"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (picked.length > 0) void openSourceFile(picked);
                }}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className={btn(true)} onClick={() => fileRef.current?.click()} disabled={busy}>
                  {fileInfo ? "Trocar arquivo" : "Abrir arquivo"}
                </button>
                <button type="button" className={btn()} onClick={closeSourceFile} disabled={!fileInfo}>
                  Fechar
                </button>
              </div>
              {fileInfo ? (
                <p className="mt-3 text-sm text-ink">
                  {fileInfo.name} · {streamRef.current?.scanned.toLocaleString("pt-BR") ?? 0} partidas lidas até agora
                </p>
              ) : null}
              <details className="mt-3 text-sm text-muted">
                <summary className="min-h-11 cursor-pointer py-2">Formatos aceitos</summary>
                Aceita bancos do En Croissant (.db3, sem limite de tamanho: só as páginas pedidas são lidas), PGN em .pgn, .pgn.zst ou .pgn.gz (as bases mensais da Lichess) e bancos SQLite (.db) com coluna pgn, ou white e moves. Você pode escolher o .db3 e o .ecsi juntos; o .ecsi (busca por posição) ainda não é usado. Cada busca recomeça do início; “Próxima” continua de onde parou. Para buscar por jogador sem varrer o arquivo todo, crie os índices no En Croissant (menu do banco).
              </details>
            </>
          ) : (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".pgn,.txt,.zst,.gz,.db,.sqlite,.sqlite3"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importFile(file);
                }}
              />
              <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="repo-max">
                Quantas partidas importar
              </label>
              <select id="repo-max" value={maxGames} disabled={importing} onChange={(event) => setMaxGames(Number(event.target.value))} className={input()}>
                <option value={0}>Todas do arquivo</option>
                <option value={1000000}>Até 1 milhão</option>
                <option value={200000}>Até 200 mil</option>
                <option value={50000}>Até 50 mil</option>
                <option value={10000}>Até 10 mil</option>
              </select>
              <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="repo-minelo">
                Só partidas com rating mínimo
              </label>
              <select id="repo-minelo" value={minElo} disabled={importing} onChange={(event) => setMinElo(Number(event.target.value))} className={input()}>
                <option value={0}>Sem filtro</option>
                {[1500, 1800, 2000, 2200, 2400].map((value) => (
                  <option key={value} value={value}>
                    {value}+
                  </option>
                ))}
              </select>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {importing ? (
                  <button type="button" className={btn()} onClick={() => importAbort.current?.abort()}>
                    Cancelar
                  </button>
                ) : (
                  <button type="button" className={btn(true)} onClick={() => importRef.current?.click()}>
                    Importar
                  </button>
                )}
                <button
                  type="button"
                  className={btn()}
                  disabled={!total || importing}
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      return;
                    }
                    void clearGames().then(async () => {
                      setConfirmClear(false);
                      setNote("Repositório apagado.");
                      setFamily("");
                      setSource("");
                      resetResults();
                      await refreshMeta();
                    });
                  }}
                >
                  {confirmClear ? "Confirmar" : "Limpar tudo"}
                </button>
              </div>
              {importing && pct != null ? (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-walnut transition-[width] duration-300" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
              <p className="mt-3 text-sm text-muted">Importar guarda as partidas no aparelho e deixa a busca instantânea, mas leva tempo em arquivos grandes. Para ver rápido, prefira “Arquivo”.</p>
            </>
          )}
        </section>

        {mode === "local" && sources.length > 0 ? (
          <section className="rounded-3xl border border-line bg-paper p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Arquivos importados</h2>
            <ul className="flex flex-col gap-2">
              {sources.map((item) => (
                <li key={item.name} className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {item.name} <span className="text-muted">· {item.games.toLocaleString("pt-BR")}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-sm text-bad underline"
                    disabled={importing}
                    onClick={() => {
                      void deleteSource(item.name).then(() => {
                        setSource("");
                        resetResults();
                        return refreshMeta();
                      });
                    }}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-muted" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm text-muted">{label}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">{children}</div>
    </div>
  );
}

function input() {
  return "min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm";
}

function chip(active: boolean) {
  return `min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-sm ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}

function btn(active = false) {
  return `min-h-11 rounded-lg px-3 text-sm disabled:opacity-50 ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}
