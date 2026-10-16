// Decode the full runtime string table and find the Engine's public API.
const fs = require('fs');
const src = fs.readFileSync('review/runtime.js', 'utf8');
const decode = require('./_decoder.js');

const out = new Map();
for (let i = 0x19c; i < 0x19c + 4000; i++) {
  let v; try { v = decode(i); } catch { continue; }
  if (typeof v === 'string') out.set(i, v);
}
console.log('total decoded:', out.size);

const want = /setRatings|setCoach|UserColor|HumanPlaysBlack|fetchFullAnalysis|analyze|init|setOption|coach|Color/i;
const hits = [...out.entries()].filter(([i, v]) => want.test(v));
console.log('\n--- API-ish strings ---');
for (const [i, v] of hits) {
  if (v.length < 90) console.log('0x' + i.toString(16), JSON.stringify(v));
}
