import fs from "node:fs";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as SQLite from "wa-sqlite";
import { EcDatabase } from "./ec-bundle.mjs";

const path = "/tmp/ec-test.db3";
const fd = fs.openSync(path, "r");
let bytesRead = 0, reads = 0;
const reader = { size: fs.statSync(path).size, read(offset, length) { const buf = Buffer.alloc(length); const n = fs.readSync(fd, buf, 0, length, offset); bytesRead += n; reads++; return new Uint8Array(buf.buffer, buf.byteOffset, n); } };

const module = await SQLiteESMFactory({ wasmBinary: fs.readFileSync("/tmp/proto/node_modules/wa-sqlite/dist/wa-sqlite.wasm") });
const sqlite3 = SQLite.Factory(module);
let t = Date.now();
const db = await EcDatabase.open(sqlite3, reader, "ec-test.db3");
if (db.ec === false) { console.log("NÃO É EC", db); process.exit(1); }
console.log("aberto em", Date.now() - t, "ms | info:", JSON.stringify({ ...db.info, tables: undefined }), "| lido:", (bytesRead / 1e6).toFixed(2), "MB de", (reader.size / 1e6).toFixed(1));

t = Date.now();
let rows = await db.page({}, 0, 1000, 25);
console.log("página 1:", rows.length, "linhas em", Date.now() - t, "ms | primeira:", JSON.stringify(rows[0]), "| lido total:", (bytesRead / 1e6).toFixed(2), "MB");

// paginação por cursor
const second = await db.page({}, rows[rows.length - 1].id, 1000, 25);
console.log("página 2 começa em id", second[0].id, "(esperado", rows[rows.length - 1].id + 1, ")");

// filtros
const ids = await db.ids("players", "magnus");
console.log("ids 'magnus':", ids);
t = Date.now();
const m = await db.page({ playerIds: ids }, 0, 200000, 10);
console.log("jogador Magnus_Test:", m.length, "linhas; ids", m.map((r) => r.id).join(","), "em", Date.now() - t, "ms | lido total:", (bytesRead / 1e6).toFixed(2), "MB");
const elo = await db.page({ minElo: 2400, resultRaw: [2], yearFrom: 2015, yearTo: 2016 }, 0, 50000, 5);
console.log("elo>=2400 & result=2 & 2015-2016:", elo.length, JSON.stringify(elo.map((r) => [r.id, r.date, r.result, r.whiteElo, r.blackElo])));
const eco = await db.page({ textEco: ["B07", "B08"], kindEco: ["B07", "B08", "B09"] }, 0, 5000, 5);
console.log("ECO B07/B08:", eco.map((r) => r.eco).join(","));

// decodificação
t = Date.now();
const game = await db.loadGame(rows[0].id);
console.log("partida", rows[0].id, "decodificada em", Date.now() - t, "ms | ok:", game.ok, "| plies:", game.plies.length - 1, "| primeiros lances:", game.san.split(" ").slice(0, 8).join(" "));
await db.close();
console.log("TOTAL lido do arquivo:", (bytesRead / 1e6).toFixed(2), "MB em", reads, "leituras");
