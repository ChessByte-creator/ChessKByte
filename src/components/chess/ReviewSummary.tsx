import { JUDGMENT_META, JUDGMENT_ORDER, type Judgment, type JudgmentCounts } from "@/lib/eval";

type Props = {
  counts: { w: JudgmentCounts; b: JudgmentCounts };
  /** Categoria do lance que está no tabuleiro (destaca a linha). */
  active?: Judgment | null;
  onJump: (judgment: Judgment) => void;
};

/** Contagem de cada categoria de lance, por lado. Clicar numa linha pula para o próximo lance daquela categoria. */
export function ReviewSummary({ counts, active = null, onJump }: Props) {
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] bg-cream px-3 py-1.5 text-xs text-muted">
        <span>Categoria</span>
        <span className="text-right">Brancas</span>
        <span className="text-right">Pretas</span>
      </div>
      <ul>
        {JUDGMENT_ORDER.map((id) => {
          const meta = JUDGMENT_META[id];
          const white = counts.w[id];
          const black = counts.b[id];
          const empty = white + black === 0;
          return (
            <li key={id} className="border-t border-line">
              <button
                type="button"
                disabled={empty}
                onClick={() => onJump(id)}
                aria-label={`${meta.plural}: brancas ${white}, pretas ${black}`}
                className={`grid min-h-10 w-full grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center px-3 text-left text-sm ${active === id ? "bg-soft" : "bg-paper"} ${empty ? "opacity-45" : "hover:bg-soft"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] leading-none font-bold text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {meta.glyph}
                  </span>
                  <span className="truncate" style={{ color: meta.ink }}>
                    {meta.label}
                  </span>
                </span>
                <span className="text-right font-mono tabular-nums text-ink">{white}</span>
                <span className="text-right font-mono tabular-nums text-ink">{black}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
