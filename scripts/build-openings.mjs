// Gera src/lib/openings-data.json a partir dos TSV do repositório lichess-org/chess-openings (CC0).
// Uso: node scripts/build-openings.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["a", "b", "c", "d", "e"];

export function epdOf(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}
export function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const entries = [];
const epd = {};
const book = new Set();
let dup = 0;

for (const letter of files) {
  const lines = readFileSync(join(root, "scripts/openings-src", `${letter}.tsv`), "utf8").split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split("\t");
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();
    const replay = new Chess();
    for (const san of history) {
      replay.move(san);
      book.add(hashText(epdOf(replay.fen())));
    }
    const finalEpd = epdOf(replay.fen());
    const index = entries.length;
    entries.push([eco, name, history.join(" ")]);
    if (epd[finalEpd] !== undefined) {
      dup += 1;
      // mantém o nome mais curto (mais genérico) quando duas linhas chegam à mesma posição
      if (entries[epd[finalEpd]][1].length <= name.length) continue;
    }
    epd[finalEpd] = index;
  }
}

const out = { v: 1, entries, epd, book: [...book].join(" ") };
writeFileSync(join(root, "src/lib/openings-data.json"), JSON.stringify(out));
console.log(`aberturas: ${entries.length} · posições nomeadas: ${Object.keys(epd).length} · posições de livro: ${book.size} · transposições: ${dup}`);
