import type { GameInfo } from "@/lib/game-info";
import { openingNamePt } from "@/lib/openings";

const RESULT_TEXT = { "1-0": "1–0 · Brancas venceram", "0-1": "0–1 · Pretas venceram", "1/2-1/2": "½–½ · Empate", "*": "Sem resultado" } as const;

type Props = {
  info: GameInfo;
  onBack: () => void;
  onDismiss: () => void;
};

/** Cartão com os dados da partida aberta a partir do repositório e o caminho de volta para a lista. */
export function GameInfoCard({ info, onBack, onDismiss }: Props) {
  const url = /^https?:\/\//i.test(info.site) ? info.site : "";
  const details = [info.event, url ? "" : info.site, info.year ? String(info.year) : "", info.timeControl && info.timeControl !== "-" ? info.timeControl : ""].filter(Boolean);
  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-paper p-3" aria-label="Partida do repositório">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">Partida do repositório</p>
          <p className="mt-0.5 text-sm text-ink">
            <span className="font-medium">{info.white}</span>
            {info.whiteElo ? <span className="text-muted"> ({info.whiteElo})</span> : null} <span className="text-muted">×</span> <span className="font-medium">{info.black}</span>
            {info.blackElo ? <span className="text-muted"> ({info.blackElo})</span> : null}
          </p>
          <p className="mt-0.5 text-sm text-ink">{RESULT_TEXT[info.result]}</p>
          {info.eco || info.opening ? (
            <p className="mt-0.5 text-xs text-muted">
              {info.eco ? <span className="font-mono">{info.eco}</span> : null}
              {info.opening ? ` ${openingNamePt(info.opening)}` : ""}
              {info.plies ? ` · ${Math.ceil(info.plies / 2)} lances` : ""}
            </p>
          ) : null}
          {details.length > 0 ? <p className="mt-0.5 truncate text-xs text-muted">{details.join(" · ")}</p> : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-walnut underline">
              Abrir a partida original
            </a>
          ) : null}
        </div>
        <button type="button" className="min-h-11 shrink-0 px-2 text-xs text-muted underline" onClick={onDismiss} aria-label="Ocultar dados da partida">
          Ocultar
        </button>
      </div>
      <button type="button" className="mt-2 min-h-11 w-full rounded-lg border border-line bg-cream px-3 text-sm text-ink" onClick={onBack}>
        ← Voltar para a lista do repositório
      </button>
    </section>
  );
}
