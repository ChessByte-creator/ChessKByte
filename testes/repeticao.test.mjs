// Teste da repetição: npx esbuild repeticao-entry.ts --bundle --format=esm --platform=node --outfile=rep-bundle.mjs --alias:@=../src --external:chess.js && node repeticao.test.mjs
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { isThreefold, repetitionCount, repetitionOfMoves, chooseWithRepetition } from "./rep-bundle.mjs";
const play = (sans) => { const c = new Chess(); const out = [{ fen: c.fen() }]; for (const s of sans) { const m = c.move(s); out.push({ fen: c.fen(), uci: m.from + m.to + (m.promotion ?? "") }); } return out; };

let p = play(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"]);
assert.equal(repetitionCount(p), 2); // a posição depois de 4.Ng1... já ocorreu uma vez antes? (conta ela mesma)
assert.equal(isThreefold(p), false);
const moves = repetitionOfMoves(p);
assert.equal(moves.find((m) => m.uci === "f6g8" || m.uci === "f6g8")?.draws, true, "Ng8 completa a terceira");
assert.equal(moves.find((m) => m.uci === "e7e6")?.draws, false);
assert.equal(isThreefold(play(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"])), true);

const cand = [{ uci: "f6g8", score: 300 }, { uci: "e7e6", score: 260 }, { uci: "d7d5", score: 100 }];
// ganhando: foge da repetição
let r = chooseWithRepetition({ plies: p, chosen: "f6g8", botCp: 300, candidates: cand });
assert.deepEqual([r.uci, r.kind], ["e7e6", "avoid"]);
// perdendo: procura a repetição
r = chooseWithRepetition({ plies: p, chosen: "e7e6", botCp: -300, candidates: [{ uci: "e7e6", score: -300 }] });
assert.deepEqual([r.uci, r.kind], ["f6g8", "seek"]);
// meio-termo: não mexe
r = chooseWithRepetition({ plies: p, chosen: "f6g8", botCp: 40, candidates: cand });
assert.equal(r.changed, false);
// ganhando mas só há linhas que repetem: mantém
r = chooseWithRepetition({ plies: p, chosen: "f6g8", botCp: 300, candidates: [{ uci: "f6g8", score: 300 }] });
assert.equal(r.changed, false);
// peão movido zera o histórico: nada repete
p = play(["Nf3", "Nf6", "Ng1", "Ng8", "e4", "e5", "Nf3", "Nf6", "Ng1"]);
assert.equal(repetitionOfMoves(p).some((m) => m.draws), false);
console.log("repetição: ok");
