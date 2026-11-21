import type { Snap } from './types';

// Klasifikasi bias: posisi Open periode berjalan terhadap Value Area periode sebelumnya.
//   Open > VAH sebelumnya -> BULLISH   |   Open < VAL sebelumnya -> BEARISH   |   di dalam VA -> BALANCE
// Lalu "status" menilai apakah harga sekarang menerima (akseptasi) atau menolak posisi open tersebut.
export interface BPer {
  name: string; valid: boolean; open: number | null; high: number | null; low: number | null;
  poc?: number; vah?: number; val?: number;
}
export type Dir = 'bull' | 'bear' | 'bal';
export interface Bias {
  label: 'BULLISH' | 'BEARISH' | 'BALANCE'; cls: 'up' | 'dn' | 'in';
  open: string; status: string; sc: 'up' | 'dn' | 'am' | 'in'; eff: Dir;
}

const f = (x: number, dec: number) => x.toFixed(dec);
const sg = (x: number, dec: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(dec);

export function bias(price: number, d: BPer | null, pv: BPer | null, dec = 2): Bias | null {
  if (!d || !d.valid || d.open == null || !pv || !pv.valid) return null;
  const o = d.open, vah = pv.vah as number, val = pv.val as number, poc = pv.poc as number;
  const n = pv.name;
  if (o > vah) {
    const hi = pv.high != null && price > pv.high ? ` · di atas high ${n}` : '';
    const [status, sc, eff]: [string, Bias['sc'], Dir] =
      price > vah ? [`Akseptasi di atas VAH — bullish berlanjut${hi}`, 'up', 'bull']
      : price >= val ? ['Kembali ke dalam VA — penolakan, bullish gagal', 'am', 'bal']
      : ['Tembus VAL — reversal penuh ke bearish', 'dn', 'bear'];
    return { label: 'BULLISH', cls: 'up', open: `Open ${f(o, dec)} di atas VAH ${n} ${f(vah, dec)} (${sg(o - vah, dec)})`, status, sc, eff };
  }
  if (o < val) {
    const lo = pv.low != null && price < pv.low ? ` · di bawah low ${n}` : '';
    const [status, sc, eff]: [string, Bias['sc'], Dir] =
      price < val ? [`Akseptasi di bawah VAL — bearish berlanjut${lo}`, 'dn', 'bear']
      : price <= vah ? ['Kembali ke dalam VA — penolakan, bearish gagal', 'am', 'bal']
      : ['Tembus VAH — reversal penuh ke bullish', 'up', 'bull'];
    return { label: 'BEARISH', cls: 'dn', open: `Open ${f(o, dec)} di bawah VAL ${n} ${f(val, dec)} (${sg(o - val, dec)})`, status, sc, eff };
  }
  const [status, sc, eff]: [string, Bias['sc'], Dir] =
    price > vah ? ['Breakout ke atas dari balance', 'up', 'bull']
    : price < val ? ['Breakout ke bawah dari balance', 'dn', 'bear']
    : ['Rotasi di dalam VA', 'in', 'bal'];
  return { label: 'BALANCE', cls: 'in', open: `Open ${f(o, dec)} di dalam VA ${n} (${o >= poc ? 'atas' : 'bawah'} POC ${f(poc, dec)})`, status, sc, eff };
}

// Label dasar (dari Open) -> arah.
export const baseDir = (b: Bias): Dir => (b.label === 'BULLISH' ? 'bull' : b.label === 'BEARISH' ? 'bear' : 'bal');

// Ringkasan beberapa profil jadi satu kalimat. Dipakai tiga kali dengan masukan berbeda:
//   dasar (label dari Open) · progres close terakhir · progres realtime.
export function summarize(dirs: (Dir | null)[]): { text: string; cls: string } {
  const v = dirs.filter((d): d is Dir => d !== null);
  if (!v.length) return { text: 'n/a', cls: 'mu' };
  const bull = v.filter((d) => d === 'bull').length, bear = v.filter((d) => d === 'bear').length, bal = v.length - bull - bear;
  const cnt = `${bull} bull · ${bear} bear · ${bal} balance`;
  if (bull && bear) return { text: `Campuran · ${cnt}`, cls: 'am' };
  if (!bull && !bear) return { text: `Balance · ${cnt}`, cls: 'in' };
  const n = bull || bear, name = bull ? 'bullish' : 'bearish', cls = bull ? 'up' : 'dn';
  if (n === v.length) return { text: `Selaras ${name} · ${cnt}`, cls };
  if (n > bal) return { text: `Condong ${name} · ${cnt}`, cls };
  if (n === bal) return { text: `Imbang ${name} vs balance · ${cnt}`, cls: 'am' };
  return { text: `Condong balance · ${cnt}`, cls: 'in' };
}

// Bias lengkap satu snapshot: dipakai dashboard DAN notifikasi Telegram supaya keduanya selalu sama.
//   live   : label dasar + status berdasarkan harga realtime
//   closed : status berdasarkan close huruf TPO terakhir yang sudah selesai (null bila belum ada)
export interface Full {
  tags: string[]; live: (Bias | null)[]; closed: (Bias | null)[];
  vBase: { text: string; cls: string }; vClose: { text: string; cls: string }; vLive: { text: string; cls: string };
}
export function fullBias(s: Snap, dec: number, order: string[] = ['W', 'D', 'S', 'M']): Full {
  const tags = order.filter((t) => s.profiles[t]);
  const prevOf = (t: string) => s.profiles[t].items[s.profiles[t].items.length - 1] ?? null;
  const live = tags.map((t) => bias(s.price, s.profiles[t].developing, prevOf(t), dec));
  const closed = tags.map((t) => { const d = s.profiles[t].developing; return d && d.lc != null ? bias(d.lc, d, prevOf(t), dec) : null; });
  return {
    tags, live, closed,
    vBase: summarize(live.map((b) => (b ? baseDir(b) : null))),
    vClose: summarize(closed.map((b) => b?.eff ?? null)),
    vLive: summarize(live.map((b) => b?.eff ?? null)),
  };
}
