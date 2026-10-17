// Gera posições com 10 linhas (Stockfish nativo, profundidade 10) para calibrar a força por rating.
import fs from "node:fs";
import { spawn } from "node:child_process";
const fens = [];
for (const f of ["kt", "bf", "sp1", "sp2", "u2"]) {
  const d = JSON.parse(fs.readFileSync(`revisao/${f}-d16.json`, "utf8"));
  d.positions.forEach((p, i) => { if (i >= 8 && i % 2 === 0 && !/ w - - 0 1$/.test(p.fen)) fens.push(p.fen); });
}
const sf = spawn("/usr/games/stockfish");
let buf = "", waiter = null;
sf.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); waiter?.(l); } });
const send = (s) => sf.stdin.write(s + "\n");
const until = (pred, on) => new Promise((res) => { waiter = (l) => { on?.(l); if (pred(l)) { waiter = null; res(); } }; });
send("uci"); await until((l) => l === "uciok");
send("setoption name Hash value 128"); send("setoption name MultiPV value 10"); send("isready"); await until((l) => l === "readyok");
const out = [];
for (const fen of fens) {
  const lines = {};
  send(`position fen ${fen}`); send("go depth 10");
  await until((l) => l.startsWith("bestmove"), (l) => {
    if (!l.startsWith("info ") || !l.includes(" score ") || l.includes("bound")) return;
    const d = Number(l.match(/depth (\d+)/)?.[1]), m = Number(l.match(/multipv (\d+)/)?.[1] ?? 1);
    const cp = l.match(/score cp (-?\d+)/), mate = l.match(/score mate (-?\d+)/), pv = l.match(/ pv (.+)/)?.[1] ?? "";
    if (!lines[m] || d >= lines[m].depth) lines[m] = { multipv: m, depth: d, scoreCp: cp ? +cp[1] : null, mate: mate ? +mate[1] : null, pv };
  });
  const ls = Object.values(lines).sort((a, b) => a.multipv - b.multipv);
  if (ls.length >= 2) out.push({ fen, lines: ls });
}
fs.writeFileSync("forca-posicoes.json", JSON.stringify(out));
console.log("posições:", out.length);
sf.kill();
