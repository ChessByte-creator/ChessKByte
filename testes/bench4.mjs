import fs from "node:fs";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as SQLite from "wa-sqlite";
import { EcDatabase } from "./ec-bundle.mjs";
const path = "/tmp/ec-big-idx.db3"; const fd = fs.openSync(path, "r");
const reader = { size: fs.statSync(path).size, read(o, l) { const b = Buffer.alloc(l); const n = fs.readSync(fd, b, 0, l, o); return new Uint8Array(b.buffer, b.byteOffset, n); } };
const sqlite3 = SQLite.Factory(await SQLiteESMFactory({ wasmBinary: fs.readFileSync("/tmp/proto/node_modules/wa-sqlite/dist/wa-sqlite.wasm") }));
const db = await EcDatabase.open(sqlite3, reader, "b.db3");
const magnus = (await db.suggestPlayers("Magnus"))[0].id;
const opp = (await db.suggestPlayers("Player285704"))[0].id;
for (const f of [{ playerIds: [magnus], opponentIds: [opp] }, { playerIds: [magnus], opponentIds: [opp], side: "white", outcome: { white: [1, 3], black: [2, 3] } }, { playerIds: [opp], opponentIds: [magnus], side: "black" }]) {
  const a = await db.pageByPlayerIndex(f, 0, 30), b = await db.page(f, 0, db.info.maxId, 30);
  console.log(JSON.stringify(f).slice(0, 90), "→", a.length, b.length, "igual:", JSON.stringify(a.map(r=>r.id)) === JSON.stringify(b.map(r=>r.id)), a[0] ? `${a[0].white} x ${a[0].black} ${a[0].result}` : "");
}
