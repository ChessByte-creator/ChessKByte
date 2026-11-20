import fs from "node:fs";
import { spawn } from "node:child_process";
import { Chess } from "chess.js";

const [,, pgnPath, outPath, depthArg, mpvArg] = process.argv;
const depth = Number(depthArg), mpv = Number(mpvArg);
const game = new Chess();
game.loadPgn(fs.readFileSync(pgnPath, "utf8"));
const hist = game.history({ verbose: true });
const fens = [hist[0].before, ...hist.map((m) => m.after)];
const moves = hist.map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion ?? ""), color: m.color }));

const sf = spawn("/usr/games/stockfish");
let buf = "", waiter = null;
sf.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); waiter?.(line); } });
const send = (s) => sf.stdin.write(s + "\n");
const until = (pred, onLine) => new Promise((res) => { waiter = (line) => { onLine?.(line); if (pred(line)) { waiter = null; res(); } }; });

send("uci"); await until((l) => l === "uciok");
send("setoption name Hash value 256"); send(`setoption name MultiPV value ${mpv}`);
send("isready"); await until((l) => l === "readyok");

const out = [];
for (let i = 0; i < fens.length; i++) {
  const lines = {};
  send(`position fen ${fens[i]}`); send(`go depth ${depth}`);
  await until((l) => l.startsWith("bestmove"), (l) => {
    if (!l.startsWith("info ") || !l.includes(" score ") || l.includes("bound")) return;
    const d = Number(l.match(/depth (\d+)/)?.[1]), m = Number(l.match(/multipv (\d+)/)?.[1] ?? 1);
    const cp = l.match(/score cp (-?\d+)/), mate = l.match(/score mate (-?\d+)/), pv = l.match(/ pv (.+)/)?.[1] ?? "";
    lines[m] = { multipv: m, depth: d, scoreCp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv };
  });
  out.push({ fen: fens[i], lines: Object.values(lines).sort((a, b) => a.multipv - b.multipv) });
  if (i % 10 === 0) { fs.writeFileSync(outPath, JSON.stringify({ moves, positions: out, depth, mpv })); console.log("pos", i, "/", fens.length - 1); }
}
fs.writeFileSync(outPath, JSON.stringify({ moves, positions: out, depth, mpv }));
send("quit"); console.log("pronto");
