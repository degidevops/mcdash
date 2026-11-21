// Membuat acuan dari implementasi TS lama (bias.ts + telegram.ts) untuk dibandingkan dengan Rust.
//   npx tsx gen_parity.ts <folder golden>
import fs from 'node:fs';
import path from 'node:path';
import { fullBias } from './bias';
import { buildMessages, DEFAULTS } from './telegram';
import { decimalsOf } from './types';

const dir = process.argv[2];
const MODES = ['mid', 'above', 'below', 'above_high', 'below_low', 'none'];
const DELTAS = [-40, -10, -3, 0, 3, 10, 40, 200];
const out: unknown[] = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('ts_'))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const base = doc.expected;
  DELTAS.forEach((delta, k) => {
    const s = JSON.parse(JSON.stringify(base));
    s.price = base.price + delta * (base.atr / 10);
    Object.keys(s.profiles).sort().forEach((tag, pi) => {
      const p = s.profiles[tag], pv = p.items[p.items.length - 1];
      const mode = MODES[(k + pi) % MODES.length];
      if (!p.developing || !pv || !pv.valid) return;
      const lc = mode === 'mid' ? (pv.vah + pv.val) / 2 : mode === 'above' ? pv.vah + 1 : mode === 'below' ? pv.val - 1
        : mode === 'above_high' ? (pv.high ?? pv.vah) + 1 : mode === 'below_low' ? (pv.low ?? pv.val) - 1 : null;
      p.developing.lc = lc; p.developing.lc_ny = lc == null ? null : p.developing.lc_ny ?? '11/13 16:15';
    });
    const dec = decimalsOf(s.point);
    out.push({ case: file.replace('.json', ''), k, delta, price: s.price, full: fullBias(s, dec, ['W', 'D', 'S', 'M']), msgs: buildMessages(s, DEFAULTS, ['Manual']) });
  });
}
fs.writeFileSync(path.join(dir, 'ts_parity.json'), JSON.stringify(out));
console.log('kasus:', out.length);
