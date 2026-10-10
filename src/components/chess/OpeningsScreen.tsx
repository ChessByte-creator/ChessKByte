import { useMemo, useState } from "react";
import { pliesFromSan, type Ply } from "@/lib/game";
import { ECO_VOLUMES, KIND_LABEL, filterOpenings, openingLine, openingNamePt, type Opening, type OpeningKind, type OpeningsIndex } from "@/lib/openings";

type Props = {
  index: OpeningsIndex | null;
  onOpen: (plies: Ply[], at?: "start" | "end") => void;
};

const KINDS: Array<{ id: OpeningKind | "all"; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "opening", label: "Aberturas" },
  { id: "defense", label: "Defesas" },
  { id: "gambit", label: "Gambitos" },
];

const PAGE = 60;

export function OpeningsScreen({ index, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OpeningKind | "all">("all");
  const [eco, setEco] = useState("");
  const [shown, setShown] = useState(PAGE);

  const results = useMemo(() => (index ? filterOpenings(index, { query, kind, eco }) : []), [index, query, kind, eco]);

  if (!index) {
    return <p className="rounded-3xl border border-line bg-paper p-4 text-sm text-muted">Carregando a base de aberturas…</p>;
  }

  return (
    <section className="rounded-3xl border border-line bg-paper p-4">
      <h2 className="text-sm font-semibold text-ink">Aberturas, defesas e gambitos</h2>
      <p className="mt-1 text-sm text-muted">
        {index.entries.length.toLocaleString("pt-BR")} linhas. Na partida, o Byte reconhece a abertura pela posição, mesmo se os lances vierem em outra ordem.
      </p>

      <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="open-search">
        Buscar por nome, código ECO ou lances (ex.: najdorf, B90, e4 c5)
      </label>
      <input
        id="open-search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setShown(PAGE);
        }}
        className="min-h-11 w-full rounded-lg border border-line bg-cream px-3 text-sm"
        placeholder="siciliana, gambito do rei, C50…"
      />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Tipo">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={kind === item.id}
            className={btn(kind === item.id)}
            onClick={() => {
              setKind(item.id);
              setShown(PAGE);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="open-eco">
        Volume ECO
      </label>
      <select
        id="open-eco"
        value={eco}
        onChange={(event) => {
          setEco(event.target.value);
          setShown(PAGE);
        }}
        className="min-h-11 w-full rounded-lg border border-line bg-cream px-2 text-sm"
      >
        <option value="">Todos</option>
        {ECO_VOLUMES.map((volume) => (
          <option key={volume.id} value={volume.id}>
            {volume.label}
          </option>
        ))}
      </select>

      <p className="mt-3 text-sm text-muted">{results.length.toLocaleString("pt-BR")} resultados</p>
      <ul className="mt-2 flex flex-col gap-2">
        {results.slice(0, shown).map((entry) => (
          <OpeningRow key={entry.id} entry={entry} onOpen={onOpen} />
        ))}
      </ul>
      {results.length > shown ? (
        <button type="button" className={`${btn()} mt-3 w-full`} onClick={() => setShown((value) => value + PAGE)}>
          Mostrar mais
        </button>
      ) : null}
    </section>
  );
}

function OpeningRow({ entry, onOpen }: { entry: Opening; onOpen: Props["onOpen"] }) {
  const pt = openingNamePt(entry.name);
  return (
    <li className="rounded-lg bg-cream px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink">
            <span className="mr-2 font-mono text-xs text-muted">{entry.eco}</span>
            {pt}
          </p>
          {pt !== entry.name ? <p className="text-xs text-muted">{entry.name}</p> : null}
          <p className="mt-1 font-mono text-xs break-words text-muted">{openingLine(entry)}</p>
          <p className="mt-1 text-xs text-walnut">
            {KIND_LABEL[entry.kind]}
            {entry.hasGambit && entry.kind !== "gambit" ? " · com gambito" : ""}
          </p>
        </div>
        <button type="button" className={`${btn(true)} shrink-0`} onClick={() => onOpen(pliesFromSan(entry.san.join(" ")), "end")}>
          Ver
        </button>
      </div>
    </li>
  );
}

function btn(active = false) {
  return `min-h-11 rounded-lg px-3 text-sm disabled:opacity-50 ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`;
}
