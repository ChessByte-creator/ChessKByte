import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Chess, type Square } from "chess.js";
import { SHAPE_COLORS, colorFromModifiers, isArrow, type Shape, type ShapeColor } from "@/lib/shapes";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

export type BoardArrow = {
  from: Square;
  to: Square;
  tone: "good" | "bad";
};

/** Selo da categoria do lance, desenhado no canto da casa de destino (estilo Chess.com). */
export type BoardBadge = {
  square: Square;
  glyph: string;
  color: string;
  label: string;
};

type Props = {
  fen: string;
  flipped: boolean;
  selected: Square | null;
  targets: Square[];
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  arrows: BoardArrow[];
  badge?: BoardBadge | null;
  /** Desenhos do usuário (setas e casas marcadas). */
  shapes?: Shape[];
  /** Pedido para desenhar/apagar uma forma (o pai decide e guarda). */
  onShape?: (shape: Shape) => void;
  /** Clique esquerdo comum apaga os desenhos (como no Lichess). */
  onClearShapes?: () => void;
  /** No modo desenho, o toque/clique esquerdo marca casas e arrasta setas (útil no celular). */
  drawMode?: boolean;
  drawColor?: ShapeColor;
  /** Premove na fila (desenhado em laranja). */
  premove?: { from: Square; to: Square } | null;
  /** Peças dessa cor podem ser pegas mesmo fora da vez, para agendar um premove. */
  premoveColor?: "w" | "b" | null;
  interactive: boolean;
  player: "w" | "b" | "both";
  onSquare: (square: Square) => void;
  onDrop: (from: Square, to: Square) => void;
};

function point(square: Square, flipped: boolean) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = (flipped ? 7 - file : file) + 0.5;
  const y = (flipped ? rank : 7 - rank) + 0.5;
  return { x: (x / 8) * 100, y: (y / 8) * 100 };
}

export function Board({
  fen,
  flipped,
  selected,
  targets,
  lastMove,
  checkSquare,
  arrows,
  badge = null,
  shapes = [],
  onShape,
  onClearShapes,
  drawMode = false,
  drawColor = "green",
  premove = null,
  premoveColor = null,
  interactive,
  player,
  onSquare,
  onDrop,
}: Props) {
  const chess = new Chess(fen);
  const turn = chess.turn();
  const ranks = flipped ? [...RANKS].reverse() : [...RANKS];
  const files = flipped ? [...FILES].reverse() : [...FILES];
  const suppressClick = useRef(false);
  const [dragFrom, setDragFrom] = useState<Square | null>(null);
  const [ghost, setGhost] = useState<{ src: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);

  const squareShapes = new Map<Square, ShapeColor>();
  const arrowShapes: Shape[] = [];
  for (const shape of draft ? [...shapes, draft] : shapes) {
    if (isArrow(shape)) arrowShapes.push(shape);
    else squareShapes.set(shape.from, shape.color);
  }

  function squareAt(x: number, y: number): Square | null {
    const hit = document.elementFromPoint(x, y);
    const value = hit?.closest("[data-square]")?.getAttribute("data-square");
    return value ? (value as Square) : null;
  }

  function beginDraw(event: ReactPointerEvent<HTMLButtonElement>, square: Square) {
    if (!onShape) return;
    event.preventDefault();
    const leftButton = event.button === 0;
    const color = colorFromModifiers(event, drawColor);
    setDraft({ from: square, color });
    function move(ev: PointerEvent) {
      const over = squareAt(ev.clientX, ev.clientY);
      setDraft({ from: square, to: over && over !== square ? over : undefined, color });
    }
    function up(ev: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDraft(null);
      // Só o botão esquerdo gera "click" depois; o direito não, então não pode deixar a trava ligada.
      if (leftButton) suppressClick.current = true;
      if (ev.type === "pointercancel") return;
      const over = squareAt(ev.clientX, ev.clientY);
      onShape?.({ from: square, to: over && over !== square ? over : undefined, color });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function pieceSrc(color: string, type: string) {
    return `/pieces/${color}${type.toUpperCase()}.svg`;
  }

  function canDrag(square: Square) {
    if (!interactive) return false;
    const piece = chess.get(square);
    if (!piece) return false;
    if (piece.color !== turn && piece.color !== premoveColor) return false;
    return player === "both" || piece.color === player;
  }

  function beginPointer(event: ReactPointerEvent<HTMLButtonElement>, square: Square) {
    if (!canDrag(square)) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const piece = chess.get(square);
    if (!piece) return;
    let moved = false;
    const src = pieceSrc(piece.color, piece.type);
    function move(ev: PointerEvent) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
        moved = true;
        setDragFrom(square);
      }
      if (!moved) return;
      setGhost({ src, x: ev.clientX, y: ev.clientY });
    }
    function up(ev: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGhost(null);
      setDragFrom(null);
      suppressClick.current = true;
      if (!moved) {
        onSquare(square);
        return;
      }
      const target = squareAt(ev.clientX, ev.clientY);
      if (target) onDrop(square, target);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className="relative w-full">
      <div
        className="grid aspect-square w-full touch-none grid-cols-8 grid-rows-8 overflow-hidden rounded-lg border-4 border-walnut shadow-sm"
        role="grid"
        aria-label="Tabuleiro de xadrez"
        onContextMenu={(event) => event.preventDefault()}
      >
        {ranks.map((rank) =>
          files.map((file) => {
            const square = `${file}${rank}` as Square;
            const light = (file.charCodeAt(0) + rank) % 2 === 1;
            const piece = chess.get(square);
            const isSelected = selected === square;
            const isTarget = targets.includes(square);
            const isLast = lastMove?.from === square || lastMove?.to === square;
            const isCheck = checkSquare === square;
            const dragging = dragFrom === square;
            const mark = squareShapes.get(square);
            const isPremove = premove?.from === square || premove?.to === square;
            return (
              <button
                key={square}
                type="button"
                role="gridcell"
                data-square={square}
                aria-label={square}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (!canDrag(square)) onSquare(square);
                }}
                onPointerDown={(event) => {
                  if (event.button === 2 || (drawMode && event.button === 0)) {
                    beginDraw(event, square);
                    return;
                  }
                  if (event.button === 0 && shapes.length > 0) onClearShapes?.();
                  beginPointer(event, square);
                }}
                className={`relative h-full min-h-0 w-full min-w-0 p-0.5 sm:p-1 ${light ? "bg-light" : "bg-dark"} ${isSelected ? "ring-2 ring-inset ring-walnut" : ""} ${isCheck ? "ring-2 ring-inset ring-bad" : ""}`}
              >
                {isLast ? (
                  badge ? (
                    <span className="pointer-events-none absolute inset-0 opacity-45" style={{ backgroundColor: badge.color }} />
                  ) : (
                    <span className="pointer-events-none absolute inset-0 bg-walnut/25" />
                  )
                ) : null}
                {isPremove ? <span className="pointer-events-none absolute inset-0 opacity-55" style={{ backgroundColor: PREMOVE_COLOR }} /> : null}
                {mark ? <span className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundColor: SHAPE_COLORS[mark].hex }} /> : null}
                {isTarget ? (
                  piece ? (
                    <span className="pointer-events-none absolute inset-1 rounded-full ring-2 ring-ink/35" />
                  ) : (
                    <span className="pointer-events-none absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/35" />
                  )
                ) : null}
                {piece && !dragging ? (
                  <img
                    alt=""
                    draggable={false}
                    src={pieceSrc(piece.color, piece.type)}
                    className="pointer-events-none relative z-10 h-full w-full select-none object-contain"
                  />
                ) : null}
                {file === files[0] ? (
                  <span className={`absolute top-0.5 left-1 z-0 text-xs leading-none ${light ? "text-walnut/80" : "text-cream/90"}`}>
                    {rank}
                  </span>
                ) : null}
                {rank === ranks[ranks.length - 1] ? (
                  <span className={`absolute right-1 bottom-0.5 z-0 text-xs leading-none ${light ? "text-walnut/80" : "text-cream/90"}`}>
                    {file}
                  </span>
                ) : null}
              </button>
            );
          }),
        )}
        </div>
        {arrows.length > 0 ? (
          <svg className="pointer-events-none absolute inset-1 z-20" viewBox="0 0 100 100">
            <defs>
              <marker id="arrow-good" markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto">
                <path d="M0 0 L4 2 L0 4 z" className="fill-good" />
              </marker>
              <marker id="arrow-bad" markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto">
                <path d="M0 0 L4 2 L0 4 z" className="fill-bad" />
              </marker>
            </defs>
            {arrows.map((arrow) => {
              const start = point(arrow.from, flipped);
              const end = point(arrow.to, flipped);
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              return (
                <line
                  key={`${arrow.tone}-${arrow.from}${arrow.to}`}
                  x1={start.x + ux * 2.4}
                  y1={start.y + uy * 2.4}
                  x2={end.x - ux * 3.6}
                  y2={end.y - uy * 3.6}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  className={arrow.tone === "good" ? "stroke-good" : "stroke-bad"}
                  markerEnd={arrow.tone === "good" ? "url(#arrow-good)" : "url(#arrow-bad)"}
                />
              );
            })}
          </svg>
        ) : null}
        {arrowShapes.length > 0 || premove ? (
          <svg className="pointer-events-none absolute inset-1 z-20" viewBox="0 0 100 100" aria-hidden="true">
            {premove ? <ArrowShape from={premove.from} to={premove.to} flipped={flipped} color={PREMOVE_COLOR} opacity={0.85} thin /> : null}
            {arrowShapes.map((shape) => (
              <ArrowShape key={`${shape.color}-${shape.from}${shape.to}`} from={shape.from} to={shape.to as Square} flipped={flipped} color={SHAPE_COLORS[shape.color].hex} opacity={0.8} />
            ))}
          </svg>
        ) : null}
        {badge ? (
          <BadgeOverlay badge={badge} flipped={flipped} />
        ) : null}
        {ghost ? (
          <img
            alt=""
            src={ghost.src}
            className="pointer-events-none fixed z-50 size-16 -translate-x-1/2 -translate-y-1/2 object-contain"
            style={{ left: ghost.x, top: ghost.y }}
          />
        ) : null}
      </div>
    );
  }

function BadgeOverlay({ badge, flipped }: { badge: BoardBadge; flipped: boolean }) {
  const file = badge.square.charCodeAt(0) - 97;
  const rank = Number(badge.square[1]) - 1;
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  // O tabuleiro tem borda de 4px; o selo fica no canto superior direito da casa.
  const left = ((col + 1) / 8) * 100;
  const top = (row / 8) * 100;
  return (
    <span
      role="img"
      aria-label={badge.label}
      title={badge.label}
      className="pointer-events-none absolute z-30 flex size-[7%] min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-white/90 text-[0.62rem] leading-none font-bold text-white shadow-md sm:text-xs"
      style={{
        backgroundColor: badge.color,
        left: `calc(${left}% - 0.35rem)`,
        top: `calc(${top}% + 0.2rem)`,
        transform: "translate(-100%, -35%)",
      }}
    >
      {badge.glyph}
    </span>
  );
}

const PREMOVE_COLOR = "#e07b1a";

/** Seta cheia (haste + ponta), em coordenadas de 0 a 100. */
function ArrowShape({ from, to, flipped, color, opacity, thin = false }: { from: Square; to: Square; flipped: boolean; color: string; opacity: number; thin?: boolean }) {
  const a = point(from, flipped);
  const b = point(to, flipped);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const shaft = thin ? 1.5 : 2.3;
  const headW = thin ? 4.4 : 6.2;
  const headL = thin ? 3.6 : 4.8;
  const sx = a.x + ux * 2.6;
  const sy = a.y + uy * 2.6;
  const tx = b.x - ux * 1.2;
  const ty = b.y - uy * 1.2;
  const bx = tx - ux * headL;
  const by = ty - uy * headL;
  const pts = [
    [sx + (nx * shaft) / 2, sy + (ny * shaft) / 2],
    [bx + (nx * shaft) / 2, by + (ny * shaft) / 2],
    [bx + (nx * headW) / 2, by + (ny * headW) / 2],
    [tx, ty],
    [bx - (nx * headW) / 2, by - (ny * headW) / 2],
    [bx - (nx * shaft) / 2, by - (ny * shaft) / 2],
    [sx - (nx * shaft) / 2, sy - (ny * shaft) / 2],
  ];
  return <polygon points={pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} fill={color} opacity={opacity} />;
}
