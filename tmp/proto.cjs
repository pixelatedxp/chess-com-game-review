const d = require('./_decoder.js');
const idxs = [0x2597, 0x1807, 0x1372, 0x1155, 0x299f, 0x6b1, 0xf9a, 0x14f2, 0x19bc, 0x1038, 0xd42, 0x100b, 0x23d7, 0x14b0, 0xc9e, 0x6f1, 0x271e, 0x1c5a, 0x1788, 0x103e, 0x797];
for (const i of idxs) {
  let v; try { v = d(i); } catch (e) { v = 'ERR ' + e.message; }
  console.log('0x' + i.toString(16), JSON.stringify(v));
}

// Search the whole table for HumanPlaysBlack / UserColor / option names
console.log('\n--- search for user-color option names ---');
for (let i = 0x19c; i < 0x19c + 4000; i++) {
  let v; try { v = d(i); } catch { continue; }
  if (typeof v !== 'string') continue;
  if (/HumanPlaysBlack|UserColor|PerspectiveForOpponent|setoption name/i.test(v)) {
    console.log('0x' + i.toString(16), JSON.stringify(v));
  }
}
