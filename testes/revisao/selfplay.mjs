import fs from "node:fs";
import { spawn } from "node:child_process";
import { Chess } from "chess.js";
const sf = spawn("/usr/games/stockfish");
let buf = "", waiter = null;
sf.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); waiter?.(l); } });
const send = (s) => sf.stdin.write(s + "\n");
const until = (p, f) => new Promise((r) => { waiter = (l) => { f?.(l); if (p(l)) { waiter = null; r(); } }; });
send("uci"); await until((l) => l === "uciok"); send("setoption name MultiPV value 4"); send("isready"); await until((l) => l === "readyok");
const chess = new Chess(); const seed = Number(process.argv[2] ?? 1); let rnd = seed * 7919;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let ply = 0; ply < 80 && !chess.isGameOver(); ply++) {
  send(`position fen ${chess.fen()}`); send("go depth 7");
  const lines = {};
  await until((l) => l.startsWith("bestmove"), (l) => { if (l.startsWith("info") && l.includes(" pv ") && !l.includes("bound")) { const m = Number(l.match(/multipv (\d+)/)?.[1] ?? 1), cp = l.match(/score cp (-?\d+)/), mate = l.match(/score mate (-?\d+)/); lines[m] = { cp: cp ? Number(cp[1]) : (mate ? 10000 : 0), mv: l.match(/ pv (\S+)/)[1] }; } });
  // lance variado: entre as linhas até 30cp do melhor, escolhe uma ao acaso (partida humana-like, sem sacrifícios forçados)
  const list = Object.values(lines).filter((x) => x.cp >= lines[1].cp - 30);
  const pick = list[Math.floor(rand() * list.length)] ?? lines[1];
  chess.move({ from: pick.mv.slice(0, 2), to: pick.mv.slice(2, 4), promotion: pick.mv[4] });
}
fs.writeFileSync(`sp${seed}.pgn`, chess.pgn() + "\n");
send("quit"); console.log("lances:", chess.history().length);
