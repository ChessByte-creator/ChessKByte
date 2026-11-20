import { evalBarPercent, type WhiteEval } from "@/lib/eval";

/** Barra de avaliação. `horizontal` desenha uma faixa fina (usada no celular, onde a barra vertical comeria largura do tabuleiro). */
export function EvalBar({ evalWhite, flipped, horizontal = false }: { evalWhite: WhiteEval; flipped: boolean; horizontal?: boolean }) {
  const white = evalBarPercent(evalWhite);
  if (horizontal) {
    return (
      <div className="relative h-2 w-full overflow-hidden rounded-full border border-line bg-ink" aria-hidden>
        <div
          className="eval-fill absolute top-0 bottom-0 bg-paper transition-[width] duration-300 ease-out"
          style={flipped ? { right: 0, width: `${white}%` } : { left: 0, width: `${white}%` }}
        />
      </div>
    );
  }
  return (
    <div className="relative w-6 self-stretch overflow-hidden rounded-md border border-line bg-ink sm:w-7" aria-hidden>
      <div
        className="eval-fill absolute right-0 left-0 bg-paper transition-[height] duration-300 ease-out"
        style={flipped ? { top: 0, height: `${white}%` } : { bottom: 0, height: `${white}%` }}
      />
    </div>
  );
}
