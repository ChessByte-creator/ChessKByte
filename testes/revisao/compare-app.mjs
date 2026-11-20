import fs from "node:fs";
import { Chess } from "chess.js";
const base = "./engenharia-reversa";
const TRUTH = {
  "Jogo 1/byte-chess-analise.json": { "8...Nxc3": "inaccuracy" },
  "Jogo 2/byte-chess-analise.json": { "12.Ne2": "inaccuracy", "12...Rc8": "mistake", "13.b3": "miss" },
  "Jogo 3/byte-chess-analise.json": { "4...b5": "mistake", "7...Nh5": "mistake", "8.Nh4": "miss", "9.Nf5": "great", "9...c6": "inaccuracy", "10.g4": "inaccuracy", "11...cxb5": "mistake", "12.h4": "great", "13.h5": "great", "14.Qf3": "great" },
};
for (const [file, truth] of Object.entries(TRUTH)) {
  const d = JSON.parse(fs.readFileSync(`${base}/${file}`, "utf8"));
  const c = new Chess(d.startFen); const sans = [];
  for (const u of d.moves) sans.push(c.move({ from: u.slice(0,2), to: u.slice(2,4), promotion: u[4] }).san);
  console.log("=====", file, "status", d.review.status, d.review.progress + "/" + d.review.total);
  sans.forEach((s, i0) => {
    const i = i0 + 1, m = d.review.moves[String(i)]; const k = `${Math.ceil(i/2)}${i % 2 ? "." : "..."}${s}`;
    const want = truth[k];
    const show = want || !["best", "book"].includes(m?.judgment);
    if (show) console.log(k.padEnd(11), (m?.judgment ?? "?").padEnd(11), "loss", m?.winLoss?.toFixed(1).padStart(5), `eval ${m?.evalBefore?.mate ?? m?.evalBefore?.cp} -> ${m?.evalAfter?.mate ?? m?.evalAfter?.cp}`, want ? `| chess.com: ${want}${want === m?.judgment ? " ✔" : " ✘"}` : "");
  });
  const tally = {}; Object.values(d.review.moves).forEach((m) => (tally[m.judgment] = (tally[m.judgment] ?? 0) + 1)); console.log(JSON.stringify(tally));
}
