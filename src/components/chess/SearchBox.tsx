import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlayerSuggestion } from "@/lib/importers/game-source";
import type { OpeningsIndex } from "@/lib/openings";
import { buildFamilies, ecoRange, familyToken, loadRecent, popularFamilies, searchFamilies, tokenKey, tokenLabel, type Token } from "@/lib/search-tokens";

type Suggestion = { key: string; group: string; label: string; hint?: string; token: Token };

type Props = {
  tokens: Token[];
  onChange: (tokens: Token[]) => void;
  openings: OpeningsIndex | null;
  /** Lista de jogadores do arquivo aberto (só o banco do En Croissant tem). */
  suggestPlayers?: (text: string) => Promise<PlayerSuggestion[]>;
  onSubmit: () => void;
};

/**
 * Caixa única de busca: digite um jogador, uma abertura ou um código ECO, escolha na lista e o filtro vira uma
 * etiqueta removível. Um jogador = todas as partidas dele; dois jogadores = confronto direto.
 */
export function SearchBox({ tokens, onChange, openings, suggestPlayers, onSubmit }: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<PlayerSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<Token[]>([]);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const families = useMemo(() => buildFamilies(openings), [openings]);
  const playerCount = tokens.filter((token) => token.kind === "player").length;

  // Jogadores do arquivo: espera o jogador parar de digitar e ignora respostas antigas.
  useEffect(() => {
    const text = query.trim();
    if (!suggestPlayers || text.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const mine = (seq.current += 1);
    setSearching(true);
    const timer = window.setTimeout(() => {
      suggestPlayers(text)
        .then((found) => {
          if (seq.current === mine) setHits(found);
        })
        .catch(() => {
          if (seq.current === mine) setHits([]);
        })
        .finally(() => {
          if (seq.current === mine) setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, suggestPlayers]);

  useEffect(() => {
    if (focused) setRecent(loadRecent());
  }, [focused]);

  const taken = new Set(tokens.map(tokenKey));
  const text = query.trim();
  const suggestions: Suggestion[] = [];
  const push = (item: Suggestion) => {
    if (!taken.has(tokenKey(item.token)) && !suggestions.some((existing) => existing.key === item.key)) suggestions.push(item);
  };

  if (text.length === 0) {
    for (const token of recent) push({ key: `r:${tokenKey(token)}`, group: "Recentes", label: tokenLabel(token), token });
    for (const item of popularFamilies(families).slice(0, 8)) {
      const token = familyToken(item);
      push({ key: `pop:${item.family}`, group: "Aberturas populares", label: tokenLabel(token), token });
    }
  } else {
    for (const hit of hits) {
      push({ key: `pl:${hit.id}`, group: "Jogadores", label: hit.name, hint: hit.elo ? `${hit.elo}` : undefined, token: { kind: "player", name: hit.name, id: hit.id, elo: hit.elo } });
    }
    for (const item of searchFamilies(families, text, 5)) {
      const token = familyToken(item);
      push({ key: `fam:${item.family}`, group: "Aberturas", label: tokenLabel(token), token });
    }
    const eco = ecoRange(text);
    if (eco.length > 0) {
      const label = eco.length === 1 ? eco[0] : `${eco[0]}–${eco[eco.length - 1]}`;
      push({ key: `eco:${label}`, group: "Código ECO", label: `ECO ${label}`, token: { kind: "eco", label: `ECO ${label}`, ecos: eco } });
    }
    if (text.length >= 2) {
      if (!suggestPlayers || hits.length === 0) push({ key: `plx:${text}`, group: "Jogadores", label: `Jogador “${text}” (parte do nome)`, token: { kind: "player", name: text } });
      push({ key: `txt:${text}`, group: "Evento ou texto", label: `Procurar “${text}” no evento`, token: { kind: "text", value: text } });
    }
  }

  function add(token: Token) {
    let next = tokens;
    if (token.kind === "player") {
      // No máximo 2 jogadores (jogador + adversário); um terceiro troca o adversário.
      const players = tokens.filter((item) => item.kind === "player");
      next = players.length >= 2 ? tokens.filter((item) => item !== players[1]) : tokens;
    }
    if (token.kind === "text") next = next.filter((item) => item.kind !== "text");
    onChange([...next, token]);
    setQuery("");
    setHits([]);
  }

  const groups = [...new Set(suggestions.map((item) => item.group))];
  const open = focused && suggestions.length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="mb-1 block text-sm text-muted">
        Buscar jogador, abertura ou ECO
      </label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          setFocused(true);
          // Celular: com o teclado aberto a lista ficaria escondida; leva a caixa para o topo da tela.
          if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) {
            window.setTimeout(() => inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
          }
        }}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (suggestions[0] && text.length > 0) add(suggestions[0].token);
            else onSubmit();
          } else if (event.key === "Backspace" && query === "" && tokens.length > 0) {
            onChange(tokens.slice(0, -1));
          } else if (event.key === "Escape") {
            setFocused(false);
          }
        }}
        enterKeyHint="search"
        placeholder={playerCount === 0 ? "ex.: Magnus, Siciliana, B90" : playerCount === 1 ? "adicione um adversário ou uma abertura" : "abertura, ECO…"}
        className="min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-base text-ink"
      />
      {searching ? <p className="mt-1 text-xs text-muted">Procurando jogadores…</p> : null}

      {tokens.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Filtros ativos">
          {tokens.map((token, index) => {
            const players = tokens.filter((item) => item.kind === "player");
            const prefix = token.kind === "player" ? (token === players[0] ? "Jogador" : "Contra") : token.kind === "opening" ? "Abertura" : token.kind === "eco" ? "" : "Texto";
            return (
              <li key={`${tokenKey(token)}-${index}`}>
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-2 rounded-full bg-walnut px-4 text-sm text-cream"
                  onClick={() => onChange(tokens.filter((item) => item !== token))}
                  aria-label={`Remover filtro ${tokenLabel(token)}`}
                >
                  <span>
                    {prefix ? <span className="opacity-70">{prefix}: </span> : null}
                    {tokenLabel(token)}
                  </span>
                  <span aria-hidden="true" className="text-base leading-none">
                    ×
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <div id={listId} role="listbox" className="relative z-20 mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-paper p-1 shadow-lg lg:absolute lg:inset-x-0 lg:mt-1 lg:max-h-80">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-3 pb-1 pt-2 text-xs text-muted">{group}</p>
              {suggestions
                .filter((item) => item.group === group)
                .map((item) => (
                  <button key={item.key} type="button" role="option" aria-selected="false" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm text-ink hover:bg-soft" onMouseDown={(event) => event.preventDefault()} onClick={() => add(item.token)}>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.hint ? <span className="shrink-0 font-mono text-xs text-muted">{item.hint}</span> : null}
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
