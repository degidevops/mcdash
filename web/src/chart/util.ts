// Helpers: color, formatting, math
export const BULL = [0.149, 0.651, 0.604, 1.0] as const; // #26A69A
export const BEAR = [0.937, 0.325, 0.314, 1.0] as const; // #EF5350
export const BULL_V = [0.149, 0.651, 0.604, 0.25] as const;
export const BEAR_V = [0.937, 0.325, 0.314, 0.25] as const;
export const GRID_COLOR = [0.165, 0.180, 0.224, 1.0] as const; // #2A2E39
export const GRID_MAJOR = [0.212, 0.227, 0.271, 1.0] as const; // #363A45

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function decimalsOf(tick: number): number {
  if (tick >= 1) return 0;
  const s = tick.toString();
  const d = s.indexOf('.');
  return d < 0 ? 0 : s.length - d - 1;
}

export function fmtPrice(p: number, dec: number): string { return p.toFixed(dec); }

/** Format short time label for X axis ticks (e.g. "14:00" or "21 Nov" on daily) */
export function fmtTime(ts: number, tf: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (tf >= 1440) {
    const mo = MONTHS[d.getMonth()];
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd} ${mo}`;
  }
  return `${hh}:${mm}`;
}

/** Format short date (e.g. "21 Nov") */
export function fmtDateShort(ts: number): string {
  const d = new Date(ts * 1000);
  const mo = MONTHS[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd} ${mo}`;
}

/** Check if two unix timestamps (in seconds) are on the same calendar day */
export function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1 * 1000);
  const d2 = new Date(ts2 * 1000);
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

/** Format full date and time for crosshair and HUD (e.g. "Sat 21 Nov 2026  18:00") */
export function fmtDate(ts: number, tf = 0): string {
  const d = new Date(ts * 1000);
  const dayName = DAYS[d.getDay()];
  const mo = MONTHS[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, '0');
  const yr = d.getFullYear();
  if (tf >= 1440) {
    return `${dayName} ${dd} ${mo} ${yr}`;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dayName} ${dd} ${mo} ${yr}  ${hh}:${mm}`;
}

export function fmtChg(diff: number, dec: number): string {
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(dec)}`;
}

export function fmtPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Nice price grid step */
export function niceStep(range: number, maxTicks: number): number {
  const rough = range / maxTicks;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Nice time grid step (seconds) */
export function niceTimeStep(rangeSec: number, maxTicks: number): number {
  const steps = [60, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 604800];
  const rough = rangeSec / maxTicks;
  for (const s of steps) if (s >= rough) return s;
  return 604800;
}
