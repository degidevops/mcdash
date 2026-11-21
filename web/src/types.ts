// Tipe kawat DIGENERATE dari struct Rust oleh ts-rs (crates/core: snapshot.rs, bias.rs, wire.rs) -> ./gen/*.ts.
// Jangan menulis ulang tipe-tipe itu di sini; ubah struct Rust lalu jalankan: cargo test -p mcdash-core export_bindings
import type { PerSnap } from './gen/PerSnap.js';
import type { ProfSnap } from './gen/ProfSnap.js';
import type { TouchInfo } from './gen/TouchInfo.js';
import type { Frame } from './gen/Frame.js';

export type { Snap } from './gen/Snap.js';
export type { Meta } from './gen/Meta.js';
export type { OpenCtx } from './gen/OpenCtx.js';
export type { Bias } from './gen/Bias.js';
export type { Dir } from './gen/Dir.js';
export type { Verdict } from './gen/Verdict.js';
export type { Full } from './gen/Full.js';
export type { Msg } from './gen/Msg.js';
export type { Frame };

// Nama lama yang dipakai klien.
export type Per = PerSnap;
export type Dev = PerSnap;   // periode berjalan: lc / lc_ny terisi
export type Prof = ProfSnap;
export type Touch = TouchInfo;
export type MetaMsg = Extract<Frame, { k: 'meta' }>;
export type TickMsg = Extract<Frame, { k: 'tick' }>;
export type K = 'POC' | 'VAH' | 'VAL';

export const ORDER = ['W', 'D', 'S', 'M'];
export const NAME: Record<string, string> = { W: 'Weekly', D: 'Daily', S: 'Sessional', M: 'Micro' };
export const KEYS: K[] = ['VAH', 'POC', 'VAL'];

// Desimal harga mengikuti ukuran point simbol dari feed (mis. XAUUSD OANDA point 0.001 -> 3 desimal).
export function decimalsOf(point: number): number {
  if (!(point > 0)) return 2;
  for (let n = 0; n <= 8; n++) {
    const scaled = point * 10 ** n;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return n;
  }
  return 8;
}
