// Run the runtime's own string decoder to recover the speech templates.
const fs = require('fs');
const src = fs.readFileSync('review/runtime.js', 'utf8');

// Pull out: shuffle IIFE, _0x2cfb, _0x4bc1, and the string array
const shuffle = src.match(/\(function \(_0x2e5788, _0x45269c\)[\s\S]*?\}\)\(_0x4bc1, 0x[0-9a-f]+\);/)[0];
const decoder = src.match(/function _0x2cfb\(_0x1b16ae, _0x120ded\) \{[\s\S]*?\n\}/)[0];
const accessor = src.match(/function _0x4bc1\(\) \{[\s\S]*?return _0x119cf9;[\s\S]*?\n\}/)[0];
const array = src.match(/const _0x119cf9 = \[[\s\S]*?\n  \];/)[0];

const sandbox = `${array}
${accessor}
${decoder}
${shuffle}
module.exports = _0x2cfb;`;
fs.writeFileSync('tmp/_decoder.js', sandbox);
const decode = require('./_decoder.js');

const out = [];
for (let i = 0x19c; i < 0x19c + 3000; i++) {
  let v;
  try { v = decode(i); } catch { continue; }
  if (typeof v === 'string' && v.length) out.push([i, v]);
}
console.log('decoded', out.length, 'strings\n');
const terms = /you|your|miss|blunder|mistake|should|opponent|white|black|player/i;
for (const [i, v] of out) if (terms.test(v)) console.log('0x' + i.toString(16), JSON.stringify(v));
