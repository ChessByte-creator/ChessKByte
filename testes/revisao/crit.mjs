import fs from "node:fs";
import { Chess } from "chess.js";
const win = (cp) => { const c = Math.max(-1000, Math.min(1000, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1); };
const zone = (w) => (w >= 75 ? 3 : w >= 58 ? 2 : w >= 42 ? 1 : w >= 25 ? 0 : -1);
const ev = (l) => (l.mate != null ? (l.mate > 0 ? 10000 : -10000) : l.scoreCp ?? 0);
for (const g of ["kt", "bf", "sp1", "sp2"]) {
  const d = JSON.parse(fs.readFileSync(`${g}-d16.json`, "utf8")), sh = JSON.parse(fs.readFileSync(`${g}-d4.json`, "utf8"));
  let crit = 0, rows = [];
  for (let i = 9; i < d.positions.length; i++) {
    const p = d.positions[i - 1], mv = d.moves[i - 1]; if (p.lines.length < 2) continue;
    const top = p.lines[0].pv.split(" ")[0]; if (top !== mv.uci) continue;
    const wb = win(ev(p.lines[0])), ws = win(ev(p.lines[1])), gap = wb - ws;
    if (!(gap >= 12 && (zone(wb) - zone(ws) >= 1 || gap >= 25) && wb > 8 && wb < 90)) continue;
    const c = new Chess(p.fen); const legal = c.moves().length; const forced = legal <= 2 || (c.inCheck() && legal <= 4);
    crit++; rows.push(`${Math.ceil(i / 2)}${mv.color === "w" ? "." : "..."}${mv.san}[gap ${gap.toFixed(0)}${forced ? ", forçado" : ""}${sh.positions[i - 1].lines[0].pv.split(" ")[0] === mv.uci ? ", óbvio(raso)" : ""}]`);
  }
  console.log(g, "candidatos a Ótimo (melhor + crítico):", crit, "→", rows.join(" "));
}
