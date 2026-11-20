import fs from "node:fs";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as SQLite from "wa-sqlite";
import { EcDatabase } from "./ec-bundle.mjs";
const path = "/tmp/ec-big-idx.db3"; const fd = fs.openSync(path, "r"); let bytes = 0;
const reader = { size: fs.statSync(path).size, read(o, l) { const b = Buffer.alloc(l); const n = fs.readSync(fd, b, 0, l, o); bytes += n; return new Uint8Array(b.buffer, b.byteOffset, n); } };
const sqlite3 = SQLite.Factory(await SQLiteESMFactory({ wasmBinary: fs.readFileSync("/tmp/proto/node_modules/wa-sqlite/dist/wa-sqlite.wasm") }));
const db = await EcDatabase.open(sqlite3, reader, "b.db3");
const T = async (label, fn) => { const t = Date.now(), b = bytes; const r = await fn(); console.log(label.padEnd(50), String(Date.now() - t).padStart(5), "ms", ((bytes - b) / 1e6).toFixed(1).padStart(6), "MB", Array.isArray(r) ? `(${r.length})` : String(r)); return r; };
const sug = await T("sugestões 'mag'", () => db.suggestPlayers("mag"));
console.log("  ", sug.map((h) => `${h.name}#${h.id}/${h.elo}`).join(" | "));
await T("sugestões 'Player0007'", async () => (await db.suggestPlayers("Player0007")).length);
const magnus = sug[0].id;
await T("contagem partidas do Magnus (índice)", () => db.countPlayerGames([magnus]));
await T("contagem só de brancas", () => db.countPlayerGames([magnus], "white"));
const opp = (await db.suggestPlayers("Player000123"))[0].id;
// brutos: 1=brancas, 2=pretas, 3=empate (banco sintético)
const outcomeWin = { white: [1], black: [2] };
const cases = {
  "só jogador": { playerIds: [magnus] },
  "de brancas": { playerIds: [magnus], side: "white" },
  "de pretas": { playerIds: [magnus], side: "black" },
  "vitórias dele": { playerIds: [magnus], outcome: outcomeWin },
  "derrotas dele de brancas": { playerIds: [magnus], side: "white", outcome: { white: [2], black: [1] } },
  "contra Player000123 (confronto)": { playerIds: [opp], opponentIds: [magnus] },
  "Magnus + ECO B07..B09": { playerIds: [magnus], ecoIn: ["B07", "B08", "B09"] },
};
for (const [name, f] of Object.entries(cases)) {
  const viaIdx = await T(`${name} → índice`, () => db.pageByPlayerIndex(f, 0, 30));
  const viaScan = await T(`${name} → varredura`, () => db.page(f, 0, db.info.maxId, 30));
  console.log("   igual:", JSON.stringify(viaIdx.map((r) => r.id)) === JSON.stringify(viaScan.map((r) => r.id)), "| 1ª:", viaIdx[0] && `${viaIdx[0].white} x ${viaIdx[0].black} res=${viaIdx[0].result}`);
}
