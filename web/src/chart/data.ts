// OHLCV bar data store — parallel typed arrays for fast access
export interface BarRaw { t: number; o: number; h: number; l: number; c: number; v: number }

export class BarBuffer {
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
  len = 0;
  private cap = 0;

  constructor(cap = 4096) { this.cap = cap; this.t = new Float64Array(cap); this.o = new Float64Array(cap); this.h = new Float64Array(cap); this.l = new Float64Array(cap); this.c = new Float64Array(cap); this.v = new Float64Array(cap); }

  private grow(): void {
    this.cap *= 2;
    const copy = (old: Float64Array) => { const n = new Float64Array(this.cap); n.set(old); return n; };
    this.t = copy(this.t); this.o = copy(this.o); this.h = copy(this.h); this.l = copy(this.l); this.c = copy(this.c); this.v = copy(this.v);
  }

  clear(): void { this.len = 0; }

  /** Load bulk bars (sorted by time ascending) */
  load(bars: BarRaw[]): void {
    while (this.cap < bars.length) this.grow();
    this.len = bars.length;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      this.t[i] = b.t; this.o[i] = b.o; this.h[i] = b.h; this.l[i] = b.l; this.c[i] = b.c; this.v[i] = b.v;
    }
  }

  /** Sisipkan bar LEBIH LAMA di depan (lazy-load saat pan ke kiri). Indeks semua bar yang sudah
   *  ada bergeser sebanyak bars.length — pemanggil harus menggeser viewport-nya juga. */
  prepend(bars: BarRaw[]): void {
    if (bars.length === 0) return;
    const need = this.len + bars.length;
    if (this.cap < need) {
      let cap = Math.max(this.cap, 4096);
      while (cap < need) cap *= 2;
      const grow = (old: Float64Array) => { const n = new Float64Array(cap); n.set(old.subarray(0, this.len), bars.length); return n; };
      this.t = grow(this.t); this.o = grow(this.o); this.h = grow(this.h); this.l = grow(this.l); this.c = grow(this.c); this.v = grow(this.v);
      this.cap = cap;
    } else {
      // geser konten [0, len) ke kanan sejauh bars.length (copyWithin aman untuk area tumpang tindih)
      const shift = (arr: Float64Array) => arr.copyWithin(bars.length, 0, this.len);
      shift(this.t); shift(this.o); shift(this.h); shift(this.l); shift(this.c); shift(this.v);
    }
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      this.t[i] = b.t; this.o[i] = b.o; this.h[i] = b.h; this.l[i] = b.l; this.c[i] = b.c; this.v[i] = b.v;
    }
    this.len += bars.length;
  }

  /** Update or append a single bar */
  upsert(bar: BarRaw): void {
    // find existing by timestamp (last few bars are most common)
    for (let i = this.len - 1; i >= Math.max(0, this.len - 5); i--) {
      if (this.t[i] === bar.t) {
        this.o[i] = bar.o; this.h[i] = bar.h; this.l[i] = bar.l; this.c[i] = bar.c; this.v[i] = bar.v;
        return;
      }
    }
    // append
    if (this.len >= this.cap) this.grow();
    const i = this.len++;
    this.t[i] = bar.t; this.o[i] = bar.o; this.h[i] = bar.h; this.l[i] = bar.l; this.c[i] = bar.c; this.v[i] = bar.v;
  }

  /** Update close price of last bar (for tick updates) */
  updateLast(price: number): void {
    if (this.len === 0) return;
    const i = this.len - 1;
    this.c[i] = price;
    if (price > this.h[i]) this.h[i] = price;
    if (price < this.l[i]) this.l[i] = price;
  }

  priceRange(from: number, to: number): [number, number] {
    let lo = Infinity, hi = -Infinity;
    const a = Math.max(0, Math.floor(from)), b = Math.min(this.len - 1, Math.ceil(to));
    for (let i = a; i <= b; i++) {
      if (this.h[i] > hi) hi = this.h[i];
      if (this.l[i] < lo) lo = this.l[i];
    }
    return [lo, hi];
  }

  maxVolume(from: number, to: number): number {
    let mx = 0;
    const a = Math.max(0, Math.floor(from)), b = Math.min(this.len - 1, Math.ceil(to));
    for (let i = a; i <= b; i++) if (this.v[i] > mx) mx = this.v[i];
    return mx;
  }

  lastPrice(): number { return this.len > 0 ? this.c[this.len - 1] : 0; }
  lastTime(): number { return this.len > 0 ? this.t[this.len - 1] : 0; }
}
