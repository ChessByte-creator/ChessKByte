// Calibra a força por rating: perda média de chance de vitória por lance, taxa de "lances ruins" e de melhor lance.
// npx esbuild forca-entry.ts --bundle --format=esm --platform=node --outfile=forca-bundle.mjs --alias:@=../src --external:chess.js && node forca.test.mjs
import fs from "node:fs";
import { pickByRating } from "./forca-bundle.mjs";
const positions = JSON.parse(fs.readFileSync("forca-posicoes.json", "utf8"));
// Metas (aprox. médias públicas de Chess.com/Lichess; ajuste à vontade): perda média por lance (pontos de chance de vitória)
// e fração de lances com perda ≥ 20 pontos.
const TARGET = { 800: [8.0, 0.08], 1000: [6.2, 0.06], 1200: [4.8, 0.045], 1400: [3.7, 0.033], 1600: [2.9, 0.022], 1800: [2.2, 0.014], 2000: [1.6, 0.009], 2200: [1.1, 0.005], 2400: [0.7, 0.002] };
const N = 300;
let rng = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
const rows = [];
for (const rating of Object.keys(TARGET).map(Number)) {
  let loss = 0, bad = 0, best = 0, n = 0, lapses = 0;
  for (const p of positions) for (let k = 0; k < N / 10; k++) {
    const c = pickByRating({ lines: p.lines, rating, rng });
    if (!c) continue;
    loss += c.loss; n++; if (c.loss >= 20) bad++; if (c.loss === 0) best++; if (c.lapse) lapses++;
  }
  const [tl, tb] = TARGET[rating];
  rows.push({ rating, perda: (loss / n).toFixed(2), meta: tl, ruins: (bad / n * 100).toFixed(1) + "%", metaRuins: (tb * 100).toFixed(1) + "%", melhor: (best / n * 100).toFixed(0) + "%" });
}
console.table(rows);
