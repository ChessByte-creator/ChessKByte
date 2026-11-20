import type { Square } from "chess.js";

export type ShapeColor = "green" | "red" | "blue" | "yellow";

export const SHAPE_COLORS: Record<ShapeColor, { hex: string; letter: string; label: string }> = {
  green: { hex: "#3f9b4f", letter: "G", label: "Verde" },
  red: { hex: "#d6453d", letter: "R", label: "Vermelho" },
  blue: { hex: "#3b78c4", letter: "B", label: "Azul" },
  yellow: { hex: "#e0a823", letter: "Y", label: "Amarelo" },
};

/** Casa marcada (sem `to`) ou seta (com `to` diferente de `from`). */
export type Shape = { from: Square; to?: Square; color: ShapeColor };

export function isArrow(shape: Shape): shape is Shape & { to: Square } {
  return Boolean(shape.to && shape.to !== shape.from);
}

function sameSpot(a: Shape, b: Shape) {
  return a.from === b.from && (a.to ?? a.from) === (b.to ?? b.from);
}

/** Desenhar a mesma coisa de novo apaga; com outra cor, troca a cor. */
export function toggleShape(list: Shape[], shape: Shape): Shape[] {
  const normalized: Shape = shape.to && shape.to !== shape.from ? shape : { from: shape.from, color: shape.color };
  const existing = list.find((item) => sameSpot(item, normalized));
  if (!existing) return [...list, normalized];
  if (existing.color === normalized.color) return list.filter((item) => item !== existing);
  return list.map((item) => (item === existing ? normalized : item));
}

/** Cor pelas teclas modificadoras (como no Lichess): Shift vermelho, Ctrl/Cmd azul, Alt amarelo. */
export function colorFromModifiers(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, fallback: ShapeColor): ShapeColor {
  if (event.shiftKey) return "red";
  if (event.ctrlKey || event.metaKey) return "blue";
  if (event.altKey) return "yellow";
  return fallback;
}

export function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

export function sanitizeShapes(input: unknown): Shape[] {
  if (!Array.isArray(input)) return [];
  const out: Shape[] = [];
  for (const raw of input) {
    const item = raw as Partial<Shape> | null;
    if (!item || !isSquare(item.from)) continue;
    if (!item.color || !(item.color in SHAPE_COLORS)) continue;
    out.push(item.to && isSquare(item.to) ? { from: item.from, to: item.to, color: item.color } : { from: item.from, color: item.color });
  }
  return out.slice(0, 64);
}
