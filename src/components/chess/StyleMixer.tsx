import { useState } from "react";
import { DEFAULT_MIX, MIX_IDS, getCustomMix, personalityById, setCustomMix, traitProfile, type MixId, type StyleMix } from "@/lib/style";

function labelOf(id: MixId) {
  return id === "balanced" ? "Stockfish puro" : personalityById(id).name;
}

/** Controles do perfil "Personalizado": uma barra por personalidade, intensidade e o perfil resultante em 6 eixos. */
export function StyleMixer() {
  const [mix, setMix] = useState<StyleMix>(() => getCustomMix());
  const apply = (next: StyleMix) => {
    setMix(next);
    setCustomMix(next);
  };
  const profile = traitProfile(personalityById("custom"));

  return (
    <div className="mt-3 rounded-2xl border border-line bg-cream p-3">
      <p className="text-sm font-semibold text-ink">Misture as personalidades</p>
      <p className="text-xs text-muted">Cada barra é o quanto daquele estilo entra. "Stockfish puro" dilui o estilo.</p>

      <div className="mt-2 grid gap-1">
        {MIX_IDS.map((id) => {
          const value = mix.shares[id] ?? 0;
          return (
            <label key={id} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm text-ink">
              <span className="truncate">{labelOf(id)}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={value}
                onChange={(event) => apply({ ...mix, shares: { ...mix.shares, [id]: Number(event.target.value) } })}
                className="min-h-11 w-full accent-walnut"
              />
              <span className="text-right text-xs text-muted">{value}%</span>
            </label>
          );
        })}
        <label className="mt-1 grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm font-semibold text-ink">
          <span>Intensidade</span>
          <input
            type="range"
            min={0}
            max={150}
            step={10}
            value={mix.intensity}
            onChange={(event) => apply({ ...mix, intensity: Number(event.target.value) })}
            className="min-h-11 w-full accent-walnut"
          />
          <span className="text-right text-xs font-normal text-muted">{mix.intensity}%</span>
        </label>
      </div>

      <p className="mt-2 text-xs font-semibold text-ink">Como ele vai jogar</p>
      <div className="mt-1 grid gap-1.5">
        {profile.map((item) => (
          <div key={item.id} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-ink">
            <span>{item.label}</span>
            <div className="relative h-2 rounded-full bg-line" role="img" aria-label={`${item.label}: ${Math.round(item.value * 100)}`}>
              <div className="absolute inset-y-0 left-1/2 w-px bg-muted" />
              {item.value >= 0 ? (
                <div className="absolute inset-y-0 left-1/2 rounded-r-full bg-walnut" style={{ width: `${item.value * 50}%` }} />
              ) : (
                <div className="absolute inset-y-0 right-1/2 rounded-l-full bg-muted" style={{ width: `${-item.value * 50}%` }} />
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">Direita: busca. Esquerda: evita.</p>

      <button
        type="button"
        onClick={() => apply(DEFAULT_MIX)}
        className="mt-2 min-h-11 rounded-xl border border-line bg-paper px-3 text-sm text-ink"
      >
        Restaurar mistura padrão
      </button>
    </div>
  );
}
