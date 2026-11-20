import fs from "node:fs";
import { pickByRating, ANCHORS } from "./forca-bundle.mjs";
const positions = JSON.parse(fs.readFileSync("forca-posicoes.json", "utf8"));
const TARGET = { 800: [8.0, 0.08], 1000: [6.2, 0.06], 1200: [4.8, 0.045], 1400: [3.7, 0.033], 1600: [2.9, 0.022], 1800: [2.2, 0.014], 2000: [1.6, 0.009], 2200: [1.1, 0.005], 2400: [0.7, 0.002] };
let s = 99; const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function measure(rating, N = 40) {
  let loss = 0, bad = 0, n = 0;
  for (const p of positions) for (let k = 0; k < N; k++) { const c = pickByRating({ lines: p.lines, rating, rng }); loss += c.loss; if (c.loss >= 20) bad++; n++; }
  return [loss / n, bad / n];
}
for (const a of ANCHORS) {
  const [tl, tb] = TARGET[a.rating];
  for (let it = 0; it < 14; it++) {
    const [l, b] = measure(a.rating);
    a.temperature *= Math.pow(tl / Math.max(l, 0.01), 0.8);
    a.lapse = Math.min(0.5, a.lapse * Math.pow(tb / Math.max(b, 0.0005), 0.6));
  }
  const [l, b] = measure(a.rating, 80);
  console.log(`{ rating: ${a.rating}, temperature: ${a.temperature.toFixed(2)}, lapse: ${a.lapse.toFixed(3)}, ...}  perda=${l.toFixed(2)}/${tl} ruins=${(b*100).toFixed(1)}%/${(tb*100).toFixed(1)}%`);
}
