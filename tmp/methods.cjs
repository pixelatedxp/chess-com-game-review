const fs = require('fs');
const src = fs.readFileSync('review/runtime.js', 'utf8');
const d = require('./_decoder.js');
const start = src.indexOf('_0x380280 = class');
const body = src.slice(start, start + 30000);

const keyRe = /\[_0x2a95cd\((0x[0-9a-f]+)\)\]/g;
const keys = [...body.matchAll(keyRe)].map(m => parseInt(m[1], 16));

for (const name of ['send', 'cmd', 'setRatings', 'enqueue', 'fetchFullAnalysis', 'init']) {
  for (const k of keys) {
    let v; try { v = d(k); } catch { continue; }
    if (v !== name) continue;
    const pat = `[_0x2a95cd(0x${k.toString(16)})]`;
    const first = body.indexOf(pat);
    const second = body.indexOf(pat, first + 1);
    const at = second > 0 ? second : first;
    console.log('=== ' + name + ' ===');
    console.log(body.slice(at, at + 800));
    console.log();
    break;
  }
}
