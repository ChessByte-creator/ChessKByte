// Busca por rating num PGN grande: confere o filtro, o progresso (a cada ~0,3 s) e o descarte pelo cabeçalho.
import assert from "node:assert/strict";
import { GameStream } from "./stream-bundle.mjs";
const N = 60000;
let pgn = "";
for (let i = 0; i < N; i++) {
  const w = i % 500 === 0 ? 900 + (i % 7) * 40 : 2200 + (i % 300), b = i % 500 === 0 ? 1000 : 2300;
  pgn += `[Event "t${i}"]\n[White "A${i}"]\n[Black "B${i}"]\n[Result "1-0"]\n[WhiteElo "${w}"]\n[BlackElo "${b}"]\n[ECO "C20"]\n[Opening "King's Pawn Game"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0\n\n`;
}
const file = new File([pgn], "teste.pgn");
const stream = await GameStream.open(file, null);
const reports = [];
const t0 = Date.now();
const found = await stream.take(25, { maxElo: 1200 }, undefined, (scanned, pct) => reports.push([Date.now() - t0, scanned, pct]));
console.log("achadas", found.length, "lidas", stream.scanned, "relatórios", reports.length, `${Date.now() - t0} ms`);
assert.equal(found.length, 25);
assert.ok(found.every((g) => g.maxElo <= 1200 && g.maxElo > 0));
assert.ok(reports.length >= 2, "deve haver progresso durante a busca");
// faixa com mínimo e máximo
stream.restart();
const band = await stream.take(10, { minElo: 1000, maxElo: 1100 }, undefined, () => {});
assert.ok(band.every((g) => g.maxElo >= 1000 && g.maxElo <= 1100));
console.log("faixa 1000–1100:", band.length, "ok");
