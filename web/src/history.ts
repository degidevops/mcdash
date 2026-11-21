// Histori per profil: untuk tiap periode selesai, bandingkan Open dan Close-nya dengan Value Area periode SEBELUMNYA.
//   Open di dalam VA sebelumnya + Close di dalam  -> "Balance tetap inside"
//   Open di dalam VA sebelumnya + Close di luar   -> "Breakout dari balance" (↑ / ↓)
//   Open di luar VA sebelumnya  + Close di luar searah -> akseptasi; Close kembali ke VA -> gagal; tembus sisi lain -> reversal
// Murni (tanpa DOM) supaya mudah diuji.

export type K = 'POC' | 'VAH' | 'VAL';
export interface HPer {
  name: string; start_ny: string; end_ny: string; valid: boolean; letters: number;
  high: number | null; low: number | null; open: number | null; close?: number | null;
  poc?: number; vah?: number; val?: number; touch: Record<K, unknown | null>;
}
export type Pos = 'above' | 'inside' | 'below';
export type Outcome =
  | 'bal-in' | 'bal-up' | 'bal-dn'
  | 'bull-acc' | 'bull-fail' | 'bull-rev'
  | 'bear-acc' | 'bear-fail' | 'bear-rev';

export interface Where { pos: Pos; dist: number }   // dist: jarak ke tepi VA terdekat yang dilewati (0 bila di dalam)
export interface HRow {
  p: HPer; pv: HPer | null; live: boolean;
  open: Where | null; close: Where | null; outcome: Outcome | null;
  probeUp: number; probeDn: number;                 // seberapa jauh High/Low menembus VAH/VAL periode sebelumnya (0 = tidak)
  pocShift: number | null; overlap: number | null;  // POC vs POC sebelumnya; % VA ini yang beririsan dengan VA sebelumnya
}

export const OUTCOME: Record<Outcome, { text: string; cls: 'up' | 'dn' | 'am' | 'in' }> = {
  'bal-in': { text: 'Balance → tetap inside', cls: 'in' },
  'bal-up': { text: 'Balance → breakout ↑', cls: 'up' },
  'bal-dn': { text: 'Balance → breakout ↓', cls: 'dn' },
  'bull-acc': { text: 'Open atas VAH → akseptasi ↑', cls: 'up' },
  'bull-fail': { text: 'Open atas VAH → balik ke VA (gagal)', cls: 'am' },
  'bull-rev': { text: 'Open atas VAH → reversal tembus VAL', cls: 'dn' },
  'bear-acc': { text: 'Open bawah VAL → akseptasi ↓', cls: 'dn' },
  'bear-fail': { text: 'Open bawah VAL → balik ke VA (gagal)', cls: 'am' },
  'bear-rev': { text: 'Open bawah VAL → reversal tembus VAH', cls: 'up' },
};

export function whereIn(x: number | null | undefined, pv: HPer | null): Where | null {
  if (x == null || !pv || !pv.valid || pv.vah == null || pv.val == null) return null;
  if (x > pv.vah) return { pos: 'above', dist: x - pv.vah };
  if (x < pv.val) return { pos: 'below', dist: pv.val - x };
  return { pos: 'inside', dist: 0 };
}

export function classify(open: Where | null, close: Where | null): Outcome | null {
  if (!open || !close) return null;
  if (open.pos === 'inside') return close.pos === 'inside' ? 'bal-in' : close.pos === 'above' ? 'bal-up' : 'bal-dn';
  if (open.pos === 'above') return close.pos === 'above' ? 'bull-acc' : close.pos === 'inside' ? 'bull-fail' : 'bull-rev';
  return close.pos === 'below' ? 'bear-acc' : close.pos === 'inside' ? 'bear-fail' : 'bear-rev';
}

function row(p: HPer, pv: HPer | null, live: boolean, close: number | null | undefined): HRow {
  const valid = !!pv && pv.valid && p.valid;
  const open = valid ? whereIn(p.open, pv) : null;
  const cl = valid ? whereIn(close, pv) : null;
  let overlap: number | null = null, pocShift: number | null = null;
  if (valid && p.vah != null && p.val != null && pv!.vah != null && pv!.val != null) {
    const ov = Math.max(0, Math.min(p.vah, pv!.vah) - Math.max(p.val, pv!.val));
    overlap = p.vah > p.val ? Math.round((100 * ov) / (p.vah - p.val)) : 0;
    if (p.poc != null && pv!.poc != null) pocShift = p.poc - pv!.poc;
  }
  return {
    p, pv, live, open, close: cl, outcome: classify(open, cl),
    probeUp: valid && p.high != null ? Math.max(0, p.high - (pv!.vah as number)) : 0,
    probeDn: valid && p.low != null ? Math.max(0, (pv!.val as number) - p.low) : 0,
    pocShift, overlap,
  };
}

// Terbaru di atas. Periode berjalan ikut (live) dengan close = harga sekarang; tidak dihitung di statistik.
export function buildRows(items: HPer[], developing: HPer | null, price: number): HRow[] {
  const rows: HRow[] = [];
  for (let i = 0; i < items.length; i++) rows.push(row(items[i], i > 0 ? items[i - 1] : null, false, items[i].close));
  rows.reverse();
  if (developing && items.length) rows.unshift(row(developing, items[items.length - 1], true, price));
  return rows;
}

export type Group = 'inside' | 'above' | 'below';
export interface Stat { group: Group; n: number; counts: Partial<Record<Outcome, number>> }

export function summarize(rows: HRow[]): Stat[] {
  const g: Record<Group, Stat> = {
    inside: { group: 'inside', n: 0, counts: {} },
    above: { group: 'above', n: 0, counts: {} },
    below: { group: 'below', n: 0, counts: {} },
  };
  for (const r of rows) {
    if (r.live || !r.outcome || !r.open) continue;
    const s = g[r.open.pos];
    s.n++;
    s.counts[r.outcome] = (s.counts[r.outcome] ?? 0) + 1;
  }
  return [g.inside, g.above, g.below];
}

export type Filter = 'all' | 'bal' | 'bal-in' | 'bal-brk' | 'out';
export function keep(r: HRow, f: Filter): boolean {
  if (f === 'all') return true;
  const o = r.open?.pos;
  if (f === 'bal') return o === 'inside';
  if (f === 'bal-in') return r.outcome === 'bal-in';
  if (f === 'bal-brk') return r.outcome === 'bal-up' || r.outcome === 'bal-dn';
  return o === 'above' || o === 'below';
}
