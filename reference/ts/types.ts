// Tipe data snapshot (dipakai bersama oleh client, server, dan notifikasi Telegram).
export type K = 'POC' | 'VAH' | 'VAL';
export interface Touch { t_ny: string; dir: string }
export interface Per {
  name: string; start: number; start_ny: string; end_ny: string; valid: boolean; letters: number; tick: number;
  high: number | null; low: number | null; open: number | null; close?: number | null;
  poc?: number; vah?: number; val?: number;
  touch: Record<K, Touch | null>;
}
export interface Dev extends Per { lc?: number | null; lc_ny?: string | null }   // lc = close huruf TPO terakhir yang sudah selesai
export interface Prof {
  tag: string; tpo_min: number; tf_min: number;
  settings: { start: string; week_start: string | null; session_hours: number | null; micro_min: number | null; va_pct: number };
  items: Per[]; developing: Dev | null;
}
export interface OpenCtx { state: string; dist?: number; poc_side?: string }
export interface Snap {
  symbol: string; tz: string; point: number; price: number; asof_ny: string; atr: number;
  profiles: Record<string, Prof>; context: { naked_count: number; open_vs_va: Record<string, OpenCtx> };
}
export interface Meta { ts: number; status: string; config_error: string | null }
export interface Msg { now: number; s: { meta: Meta; data: Snap | null } }

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
