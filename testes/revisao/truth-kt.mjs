// Verdade do Chess.com para Kasparov x Topalov 1999 (lances 24-37, da revisão enviada pelo usuário)
import fs from "node:fs";
import { Chess } from "chess.js";
import { judgePly, isRecapture, continuesLine, toWhiteEval } from "./new-bundle.mjs";
const d = JSON.parse(fs.readFileSync("kt-d16.json", "utf8")), sh = JSON.parse(fs.readFileSync("kt-d4.json", "utf8"));
const TRUTH = { "24.Rxd4":"brilliant","25.Re7+":"brilliant","28.Qc3":"brilliant","30.Rxb7":"brilliant","36.Bf1":"brilliant","37.Rd7":"brilliant",
 "21.Rhe1":"great","27.b4+":"great","29.Ra7":"great","32.Qxa6+":"great","33.c3+":"great","34.Qa1+":"great","35.Qb2+":"great",
 "21...d4":"great","23...Qd6":"great","25...Kb6":"great","29...Bb7":"great",
 "24...cxd4":"mistake","30...Qc4":"inaccuracy","31...Kxa3":"blunder","18.Na5":"inaccuracy" };
let prevLoss = 0, combo = false; const got = {};
for (let i = 1; i < d.positions.length; i++) {
  const b = d.positions[i-1], a = d.positions[i], mv = d.moves[i-1], top = a.lines[0];
  const mate = new Chess(a.fen).isCheckmate();
  const afterEval = mate ? { cp: mv.color==="w"?10000:-10000, mate: mv.color==="w"?1:-1 } : top ? toWhiteEval(top.scoreCp, top.mate, a.fen.split(" ")[1]) : { cp:0, mate:null };
  const rec = i>=2 ? isRecapture(d.positions[i-2].fen, d.moves[i-2]?.uci, mv.uci) : false;
  const pred = i>=2 && continuesLine(d.positions[i-2].lines, d.moves[i-2]?.uci, mv.uci);
  const inChain = combo && pred;
  const r = judgePly({ beforeFen:b.fen, uci:mv.uci, color:mv.color, lines:b.lines, bestUci:b.lines[0].pv.split(" ")[0], bestSan:"", afterEval, inBook:i<=10, recapture:rec, prevOpponentLoss:prevLoss, seed:i, shallowBest: sh.positions[i-1].lines[0].pv.split(" ")[0], inChain });
  combo = ["brilliant","great"].includes(r.judgment) || inChain; prevLoss = r.winLoss;
  got[`${Math.ceil(i/2)}${mv.color==="w"?".":"..."}${mv.san}`] = r.judgment;
}
const miss = [], extra = [];
for (const [k,v] of Object.entries(TRUTH)) if (got[k] !== v) miss.push(`${k}: chess.com=${v} byte=${got[k]}`);
for (const [k,v] of Object.entries(got)) if ((v==="brilliant"||v==="great") && TRUTH[k] !== v) extra.push(`${k}: byte=${v} chess.com=${TRUTH[k] ?? "-"}`);
console.log("DIVERGE:\n " + miss.join("\n ")); console.log("EXTRA:\n " + extra.join("\n "));
const c = {}; for (const v of Object.values(got)) c[v]=(c[v]??0)+1; console.log(JSON.stringify(c));
