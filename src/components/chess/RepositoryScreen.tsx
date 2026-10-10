import { useCallback, useEffect, useRef, useState } from "react";
import { clearGames, countGames, deleteSource, listSources, searchGames, topFamilies, type GameFilters, type GameRecord, type GameResult, type SourceInfo } from "@/lib/games-db";
import { importGameFile } from "@/lib/importers/game-import";
import { pliesFromSan, type Ply } from "@/lib/game";
import { KIND_LABEL, openingNamePt, type OpeningKind, type OpeningsIndex } from "@/lib/openings";

type Props = {
  openings: OpeningsIndex | null;
  onOpen: (plies: Ply[], at?: "start" | "end") => void;
};

const PAGE = 25;

const RESULT_LABEL: Record<GameResult, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "*" };

export function RepositoryScreen({ openings, onOpen }: Props) {
  const [total, setTotal] = useState<number | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [families, setFamilies] = useState<Array<{ family: string; games: number }>>([]);

  const [importing, setImporting] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [maxGames, setMaxGames] = useState(0);
  const [minElo, setMinElo] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [player, setPlayer] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<OpeningKind | "gambit" | "all">("all");
  const [result, setResult] = useState<GameResult | "all">("all");
  const [family, setFamily] = useState("");
  const [elo, setElo] = useState(0);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [source, setSource] = useState("");

  const [rows, setRows] = useState<GameRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const filters: GameFilters = {
    player: player.trim() || undefined,
    text: text.trim() || undefined,
    kind,
    result,
    family: family || undefined,
    minElo: elo || undefined,
    yearFrom: Number(yearFrom) || undefined,
    yearTo: Number(yearTo) || undefined,
    source: source || undefined,
  };
  const filtersKey = JSON.stringify(filters);

  const refreshMeta = useCallback(async () => {
    try {
      setTotal(await countGames());
      setSources(await listSources());
      setFamilies(await topFamilies());
    } catch {
      setTotal(0);
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const runSearch = useCallback(async (offset: number, current: GameFilters) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const found = await searchGames(current, offset, PAGE);
      if (seq !== searchSeq.current) return;
      setRows((previous) => (offset === 0 ? found.rows : [...previous, ...found.rows]));
      setHasMore(found.hasMore);
      setTruncated(found.truncated);
    } catch {
      if (seq === searchSeq.current) setNote("Não consegui consultar o repositório.");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!total) {
      setRows([]);
      setHasMore(false);
      return;
    }
    const handle = window.setTimeout(() => void runSearch(0, JSON.parse(filtersKey) as GameFilters), 300);
    return () => window.clearTimeout(handle);
  }, [filtersKey, total, runSearch]);

  async function importFile(file: File) {
    const abort = new AbortController();
    abortRef.current = abort;
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
      abortRef.current = null;
      setPct(null);
      setImporting(false);
      await refreshMeta();
    }
  }

  function open(game: GameRecord) {
    onOpen(pliesFromSan(game.moves), "start");
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-3xl border border-line bg-paper p-4">
        <h2 className="text-sm font-semibold text-ink">Buscar partidas</h2>
        <p className="mt-1 text-sm text-muted">
          {total == null ? "Abrindo o repositório…" : total === 0 ? "O repositório está vazio. Importe um arquivo de partidas ao lado." : `${total.toLocaleString("pt-BR")} partidas guardadas neste aparelho.`}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Jogador" id="repo-player">
            <input id="repo-player" value={player} onChange={(event) => setPlayer(event.target.value)} className={input()} placeholder="nome ou parte dele" />
          </Field>
          <Field label="Abertura, ECO ou evento" id="repo-text">
            <input id="repo-text" value={text} onChange={(event) => setText(event.target.value)} className={input()} placeholder="najdorf, B90, torneio…" />
          </Field>
          <Field label="Tipo de abertura" id="repo-kind">
            <select id="repo-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className={input()}>
              <option value="all">Todos</option>
              <option value="opening">Aberturas</option>
              <option value="defense">Defesas</option>
              <option value="gambit">Gambitos</option>
            </select>
          </Field>
          <Field label="Resultado" id="repo-result">
            <select id="repo-result" value={result} onChange={(event) => setResult(event.target.value as typeof result)} className={input()}>
              <option value="all">Qualquer</option>
              <option value="1-0">Brancas venceram</option>
              <option value="0-1">Pretas venceram</option>
              <option value="1/2-1/2">Empate</option>
            </select>
          </Field>
          <Field label="Rating mínimo (o mais forte)" id="repo-elo">
            <select id="repo-elo" value={elo} onChange={(event) => setElo(Number(event.target.value))} className={input()}>
              <option value={0}>Qualquer</option>
              {[1200, 1500, 1800, 2000, 2200, 2400, 2600].map((value) => (
                <option key={value} value={value}>
                  {value}+
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ano de" id="repo-from">
              <input id="repo-from" inputMode="numeric" value={yearFrom} onChange={(event) => setYearFrom(event.target.value.replace(/\D/g, "").slice(0, 4))} className={input()} />
            </Field>
            <Field label="Ano até" id="repo-to">
              <input id="repo-to" inputMode="numeric" value={yearTo} onChange={(event) => setYearTo(event.target.value.replace(/\D/g, "").slice(0, 4))} className={input()} />
            </Field>
          </div>
        </div>

        {sources.length > 1 ? (
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

        {families.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-sm text-muted">Famílias mais comuns</p>
            <div className="flex flex-wrap gap-2">
              {families.slice(0, 16).map((item) => (
                <button key={item.family} type="button" aria-pressed={family === item.family} className={`${chip(family === item.family)}`} onClick={() => setFamily(family === item.family ? "" : item.family)}>
                  {openingNamePt(item.family)} · {item.games.toLocaleString("pt-BR")}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((game) => (
            <li key={game.id}>
              <button type="button" onClick={() => open(game)} className="w-full rounded-lg bg-cream px-3 py-2 text-left text-sm hover:bg-soft">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">
                    {game.white}
                    {game.whiteElo ? <span className="text-muted"> ({game.whiteElo})</span> : null} <span className="text-muted">×</span> {game.black}
                    {game.blackElo ? <span className="text-muted"> ({game.blackElo})</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink">{RESULT_LABEL[game.result]}</span>
                </span>
                <span className="mt-1 block truncate text-xs text-muted">
                  {game.eco ? `${game.eco} · ` : ""}
                  {game.opening ? openingNamePt(game.opening) : "Abertura não identificada"} · {KIND_LABEL[game.kind]} · {Math.ceil(game.plies / 2)} lances
                  {game.year ? ` · ${game.year}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {total && !searching && rows.length === 0 ? <p className="mt-3 text-sm text-muted">Nenhuma partida com esses filtros.</p> : null}
        {searching ? <p className="mt-3 text-sm text-muted">Buscando…</p> : null}
        {truncated ? <p className="mt-2 text-xs text-muted">A busca parou depois de 400 mil registros. Refine os filtros para ver mais.</p> : null}
        {hasMore && !searching ? (
          <button type="button" className={`${btn()} mt-3 w-full`} onClick={() => void runSearch(rows.length, filters)}>
            Carregar mais
          </button>
        ) : null}
      </section>

      <aside className="flex flex-col gap-3">
        <section className="rounded-3xl border border-line bg-paper p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Importar partidas</h2>
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt,.zst,.gz,.db,.sqlite,.sqlite3"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <label className="mb-1 block text-sm text-muted" htmlFor="repo-max">
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
              <button type="button" className={btn()} onClick={() => abortRef.current?.abort()}>
                Cancelar
              </button>
            ) : (
              <button type="button" className={btn(true)} onClick={() => fileRef.current?.click()}>
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
          {note ? <p className="mt-3 text-sm text-ink">{note}</p> : null}
          <p className="mt-3 text-sm text-muted">
            Aceita PGN em .pgn, .pgn.zst ou .pgn.gz (como as bases mensais da Lichess), sem limite de tamanho: o arquivo é lido aos poucos. Também aceita bancos SQLite (.db) com coluna pgn, ou white e moves. O Byte identifica a abertura de cada partida e classifica em abertura, defesa ou gambito.
          </p>
        </section>

        {sources.length > 0 ? (
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
    <div className="mt-0">
      <label className="mb-1 block text-sm text-muted" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function input() {
  return "min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm";
}

function chip(active: boolean) {
  return `min-h-9 rounded-full px-3 text-xs ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}

function btn(active = false) {
  return `min-h-11 rounded-lg px-3 text-sm disabled:opacity-50 ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}
