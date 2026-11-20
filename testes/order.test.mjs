import fs from "node:fs";
import { Chess } from "chess.js";
import { legalMovesInEcOrder } from "./move-order.ts";

const MAXG = Number(process.argv[2] ?? 40); const lines = fs.readFileSync("/tmp/ref.txt", "utf8").split("\n");
let chess = null, positions = 0, games = 0, bad = 0;
for (const line of lines) {
  if (line.startsWith("G ")) { if (games >= MAXG) break; chess = new Chess(line.slice(2)); games++; continue; }
  if (!line.startsWith("P ")) continue;
  const [head, list] = line.slice(2).split(" | ");
  const [idx, uci] = head.split(" ");
  const mine = legalMovesInEcOrder(chess).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`);
  const ref = list.split(" ");
  positions++;
  if (mine.join(" ") !== ref.join(" ")) {
    if (bad++ < 3) console.log("DIFERENTE\n FEN", chess.fen(), "\n mine", mine.join(" "), "\n ref ", ref.join(" "));
  }
  const m = legalMovesInEcOrder(chess)[Number(idx)];
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
}
console.log({ games, positions, bad });
process.exit(bad ? 1 : 0);
