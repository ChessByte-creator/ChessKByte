import { PERSONALITIES, personalityById, type PersonalityId } from "@/lib/style";
import { FULL_RATING, LEVELS, MAX_RATING, MIN_RATING, ratingBand, ratingBlurb } from "@/lib/strength";

export type SideChoice = "w" | "b" | "r";

export type NewGameSettings = {
  rating: number;
  styleId: PersonalityId;
  evalBar: boolean;
  side: SideChoice;
};

/** "1350 · Intermediário" ou "Máximo". */
export function ratingText(rating: number) {
  return rating > MAX_RATING ? "Máximo" : `${rating} · ${ratingBand(rating)}`;
}

const CHIPS = [...LEVELS.map((item) => ({ rating: item.rating as number, label: item.name as string })), { rating: FULL_RATING, label: "Máximo" }];

/** Escolha de rating: atalhos pelas faixas e um controle de 50 em 50 para os meios-termos. */
export function RatingPicker({ value, onChange, idPrefix }: { value: number; onChange: (rating: number) => void; idPrefix: string }) {
  const sliderId = `${idPrefix}-rating`;
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Faixas de nível">
        {CHIPS.map((chip) => {
          const active = chip.rating === FULL_RATING ? value > MAX_RATING : value === chip.rating;
          return (
            <button
              key={chip.rating}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(chip.rating)}
              className={`min-h-11 rounded-full px-3 text-sm ${active ? "bg-walnut text-cream" : "border border-line bg-paper text-ink"}`}
            >
              {chip.label}
              <span className={`ml-1 text-xs ${active ? "text-cream/80" : "text-muted"}`}>{chip.rating === FULL_RATING ? "" : chip.rating}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-4 mb-1 flex items-baseline justify-between gap-3 text-sm text-ink" htmlFor={sliderId}>
        <span className="font-semibold">{ratingText(value)}</span>
        <span className="text-xs text-muted">arraste para meios-termos</span>
      </label>
      <input
        id={sliderId}
        type="range"
        min={MIN_RATING}
        max={MAX_RATING}
        step={50}
        value={Math.min(value, MAX_RATING)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full accent-walnut"
      />
      <div className="flex justify-between text-[0.7rem] text-muted" aria-hidden>
        <span>{MIN_RATING}</span>
        <span>1200</span>
        <span>2000</span>
        <span>{MAX_RATING}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{ratingBlurb(value)}</p>
    </div>
  );
}

function Switch({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 items-center justify-between gap-3 py-1 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-6 accent-walnut" />
    </label>
  );
}

export function NewGameSheet({
  settings,
  onChange,
  premoveOn,
  onPremoveChange,
  onStart,
  onCancel,
}: {
  settings: NewGameSettings;
  onChange: (patch: Partial<NewGameSettings>) => void;
  premoveOn: boolean;
  onPremoveChange: (value: boolean) => void;
  onStart: () => void;
  onCancel?: () => void;
}) {
  const style = personalityById(settings.styleId);
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:px-3">
      <div className="flex items-center gap-3 rounded-3xl border border-line bg-paper p-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-walnut font-display text-2xl text-cream" aria-hidden>
          {style.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-xl text-walnut">{style.name}</p>
          <p className="text-sm text-ink">{ratingText(settings.rating)}</p>
          <p className="text-xs text-muted">{style.blurb}</p>
        </div>
      </div>

      <div className="rounded-3xl border border-line bg-paper p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Nível do adversário</h2>
        <RatingPicker value={settings.rating} onChange={(rating) => onChange({ rating })} idPrefix="novo" />
      </div>

      <div className="rounded-3xl border border-line bg-paper p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Personalidade</h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Personalidade do adversário">
          {PERSONALITIES.map((item) => {
            const active = settings.styleId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ styleId: item.id })}
                className={`min-h-11 rounded-xl px-3 py-2 text-left text-sm ${active ? "bg-walnut text-cream" : "border border-line bg-cream text-ink"}`}
              >
                {item.name}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted">{style.blurb}</p>
      </div>

      <div className="rounded-3xl border border-line bg-paper p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Você joga de</h2>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Lado">
          {(
            [
              ["w", "Brancas"],
              ["r", "Aleatório"],
              ["b", "Pretas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={settings.side === id}
              onClick={() => onChange({ side: id })}
              className={`min-h-11 rounded-xl text-sm ${settings.side === id ? "bg-walnut text-cream" : "border border-line bg-cream text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-line bg-paper px-4 py-2">
        <h2 className="pt-2 text-sm font-semibold text-ink">Durante o jogo</h2>
        <Switch checked={settings.evalBar} onChange={(evalBar) => onChange({ evalBar })} label="Barra de avaliação" hint="Mostra quem está melhor. Desligada, a avaliação some da tela." />
        <Switch checked={premoveOn} onChange={onPremoveChange} label="Premoves" hint="Agendar lances na vez do adversário." />
        <Switch checked={false} onChange={() => undefined} disabled label="Tipo de lance (em breve)" hint="Mostrar a categoria de cada lance durante a partida." />
      </div>

      <div className="sticky bottom-0 z-10 -mx-3 flex gap-2 bg-cream/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        {onCancel ? (
          <button type="button" className="min-h-12 rounded-xl border border-line bg-paper px-4 text-sm text-ink" onClick={onCancel}>
            Voltar
          </button>
        ) : null}
        <button type="button" className="min-h-12 flex-1 rounded-xl bg-walnut text-base font-semibold text-cream" onClick={onStart}>
          Jogar
        </button>
      </div>
    </section>
  );
}
