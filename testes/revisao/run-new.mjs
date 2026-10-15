import fs from "node:fs";
import { Chess } from "chess.js";
import { judgePly, isRecapture, continuesLine, toWhiteEval } from "./new-bundle.mjs";
const [,, prefix = "kt", bookPlies = "10"] = process.argv;
const d = JSON.parse(fs.readFileSync(`${prefix}-d16.json`, "utf8"));
const shallow = JSON.parse(fs.readFileSync(`${prefix}-d4.json`, "utf8"));
const FLAG = new Set(["brilliant", "great"]);
let prevLoss = 0, combo = false; const out = [];
for (let i = 1; i < d.positions.length; i++) {
  const before = d.positions[i - 1], after = d.positions[i], mv = d.moves[i - 1];
  const top = after.lines[0];
  const mate = new Chess(after.fen).isCheckmate();
  const afterEval = mate ? { cp: mv.color === "w" ? 10000 : -10000, mate: mv.color === "w" ? 1 : -1 } : top ? toWhiteEval(top.scoreCp, top.mate, after.fen.split(" ")[1]) : { cp: 0, mate: null };
  const recapture = i >= 2 ? isRecapture(d.positions[i - 2].fen, d.moves[i - 2]?.uci, mv.uci) : false;
  const predicted = i >= 2 && continuesLine(d.positions[i - 2].lines, d.moves[i - 2]?.uci, mv.uci);
  const inChain = combo && predicted;
  const r = judgePly({ beforeFen: before.fen, uci: mv.uci, color: mv.color, lines: before.lines, bestUci: before.lines[0].pv.split(" ")[0], bestSan: "", afterEval, inBook: i <= Number(bookPlies), recapture, prevOpponentLoss: prevLoss, seed: i, shallowBest: shallow.positions[i - 1].lines[0].pv.split(" ")[0], inChain });
  combo = FLAG.has(r.judgment) || inChain;
  prevLoss = r.winLoss; out.push({ i, san: mv.san, color: mv.color, j: r.judgment, loss: r.winLoss, sac: r.sacrifice, inChain });
}
const flagged = out.filter((o) => FLAG.has(o.j) || (o.sac && !o.inChain));
if (process.argv[4]) console.log(out.filter((o) => o.i >= Number(process.argv[4]) && o.i <= Number(process.argv[5])).map((o) => `${Math.ceil(o.i / 2)}${o.color === "w" ? "." : "..."}${o.san}:${o.j}(${o.loss.toFixed(1)})`).join("  "));
console.log(flagged.map((o) => `${Math.ceil(o.i / 2)}${o.color === "w" ? "." : "..."}${o.san}: ${o.j}${o.sac ? " [sacrifício]" : ""}${o.inChain ? " [continuação]" : ""}`).join("\n"));
const counts = {}; for (const o of out) counts[o.j] = (counts[o.j] ?? 0) + 1; console.log(JSON.stringify(counts));
