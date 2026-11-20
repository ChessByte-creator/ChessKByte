import fs from "node:fs";
import { Chess } from "chess.js";
import { newSacrifice, isTemporarySacrifice } from "./new-bundle.mjs";
const [,, prefix, a, b] = process.argv;
const d = JSON.parse(fs.readFileSync(`${prefix}-d16.json`, "utf8"));
for (let i = +a; i <= +b; i++) {
  const bf = d.positions[i-1], mv = d.moves[i-1];
  const s = newSacrifice(bf.fen, mv.uci);
  const c = new Chess(bf.fen);
  console.log(Math.ceil(i/2)+(mv.color==="w"?".":"...")+mv.san, "inCheck=",c.inCheck(), "sac=",JSON.stringify(s), "lines=", bf.lines.map(l=>(l.mate!=null?"M"+l.mate:l.scoreCp)+" "+l.pv.split(" ").slice(0,5).join(" ")).join(" | "));
  console.log("   fen", bf.fen);
}
