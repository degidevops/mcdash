// Notifikasi Telegram: HANYA bias lengkap (dasar · close terakhir · realtime) + level per profil.
// Logika bias diambil dari bias.ts yang sama dengan dashboard, jadi isi pesan selalu konsisten dengan layar.
//
// Kapan terkirim (semua bisa diatur di telegram.json):
//   on_change      bias berubah pada lapisan di `watch` dan bertahan >= confirm_sec (anti kedip), jeda >= min_interval_sec
//   on_new_period  periode baru profil tertentu dimulai (mis. W/D/S), digabung dalam satu pesan
//   manual         tombol di dashboard
import fs from 'node:fs';
import { fullBias } from './bias';
import { ORDER, NAME, KEYS, decimalsOf, type Snap, type Per } from './types';

export type Layer = 'base' | 'close' | 'live';
export interface TgSettings {
  enabled: boolean;            // notifikasi otomatis (tombol manual tetap jalan)
  on_change: boolean;
  watch: Layer[];              // lapisan yang memicu on_change
  on_new_period: string[];     // tag profil: W D S M
  confirm_sec: number;
  min_interval_sec: number;
  send_on_start: boolean;
  profiles: string[];          // profil yang disertakan di pesan
  level_atr: number;           // naked level dipilih dalam ±N ATR dari harga (0 = semua)
  max_naked: number;           // maks naked level per profil
}
export const DEFAULTS: TgSettings = {
  enabled: true, on_change: true, watch: ['base', 'close'], on_new_period: ['W', 'D', 'S'],
  confirm_sec: 20, min_interval_sec: 300, send_on_start: false,
  profiles: ['W', 'D', 'S', 'M'], level_atr: 3, max_naked: 4,
};
const SECRET = new Set(['token', 'chat_id']);

function num(v: unknown, key: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${key}: harus angka ${lo}–${hi}`);
  return v;
}
function bool(v: unknown, key: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${key}: harus true/false`);
  return v;
}
function tags(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !ORDER.includes(x))) throw new Error(`${key}: daftar dari ${ORDER.join(', ')}`);
  return [...new Set(v as string[])];
}

// Kunci salah ketik ditolak dengan pesan jelas (token/chat_id dan kunci berawalan "_" diabaikan).
export function sanitize(raw: Record<string, unknown>): TgSettings {
  const s: TgSettings = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_') || SECRET.has(k)) continue;
    switch (k) {
      case 'enabled': s.enabled = bool(v, k); break;
      case 'on_change': s.on_change = bool(v, k); break;
      case 'send_on_start': s.send_on_start = bool(v, k); break;
      case 'confirm_sec': s.confirm_sec = num(v, k, 0, 3600); break;
      case 'min_interval_sec': s.min_interval_sec = num(v, k, 0, 86400); break;
      case 'level_atr': s.level_atr = num(v, k, 0, 50); break;
      case 'max_naked': s.max_naked = Math.round(num(v, k, 0, 20)); break;
      case 'on_new_period': s.on_new_period = tags(v, k); break;
      case 'profiles': s.profiles = tags(v, k); break;
      case 'watch':
        if (!Array.isArray(v) || v.some((x) => !['base', 'close', 'live'].includes(x as string))) throw new Error('watch: daftar dari base, close, live');
        s.watch = [...new Set(v as Layer[])]; break;
      default: throw new Error(`kunci tidak dikenal: ${k}`);
    }
  }
  return s;
}

// ---------------------------------------------------------------- isi pesan
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<string, string> = { up: '🟢', dn: '🔴', in: '🔵', am: '🟡', mu: '⚪' };
const EFF: Record<string, string> = { bull: 'BULL', bear: 'BEAR', bal: 'BAL' };
const LIMIT = 3800;                                    // batas aman di bawah 4096 karakter Telegram

export function buildMessages(s: Snap, cfg: TgSettings, reasons: string[]): string[] {
  const dec = decimalsOf(s.point);
  const f = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(dec));
  const sg = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(dec);
  const atr = s.atr || 1;
  const fb = fullBias(s, dec, ORDER.filter((t) => cfg.profiles.includes(t)));

  const head = [
    `<b>📊 ${esc(s.symbol)}</b>  <code>${f(s.price)}</code>  ·  ATR ${f(s.atr)}`,
    `<i>${esc(s.asof_ny)} ${esc(s.tz)}</i>`,
    ...(reasons.length ? [`<b>Pemicu:</b> ${esc(reasons.join(' · '))}`] : []),
    '',
    '<b>BIAS</b>',
    `Dasar    ${ICON[fb.vBase.cls] ?? '⚪'} ${esc(fb.vBase.text)}`,
    `Close    ${ICON[fb.vClose.cls] ?? '⚪'} ${esc(fb.vClose.text)}`,
    `Realtime ${ICON[fb.vLive.cls] ?? '⚪'} ${esc(fb.vLive.text)}`,
  ].join('\n');

  const blocks = fb.tags.map((t, i) => {
    const P = s.profiles[t], b = fb.live[i], cl = fb.closed[i], d = P.developing;
    const prev = P.items[P.items.length - 1] ?? null;
    if (!b || !d) return `<b>${t} · ${NAME[t]}</b>  n/a`;
    const L: string[] = [`<b>${t} · ${NAME[t]}</b>  ${ICON[b.cls]} <b>${b.label}</b>`, esc(b.open)];
    L.push(cl
      ? `Close ▸ ${ICON[cl.sc]} ${esc(cl.status)} <i>(${P.tpo_min}m · ${f(d.lc)} @ ${esc((d.lc_ny ?? '').slice(6))})</i>`
      : 'Close ▸ belum ada letter yang selesai');
    L.push(`Live  ▸ ${ICON[b.sc]} ${esc(b.status)}`);

    // tabel level: VA periode sebelumnya vs yang berjalan
    const rows: [string, Per | null][] = [[prev ? prev.name : '', prev], [d.name.replace(/-now$/, ' now'), d]];
    const w = Math.max(...rows.map((r) => r[0].length), 4);
    const cw = dec + 5;
    const line = (n: string, p: Per | null) => `${n.padEnd(w)}  ${KEYS.map((k) => {
      const v = p && p.valid ? { POC: p.poc, VAH: p.vah, VAL: p.val }[k] : null; return f(v).padStart(cw); }).join(' ')}`;
    const tbl = [`${''.padEnd(w)}  ${KEYS.map((k) => k.padStart(cw)).join(' ')}`, ...rows.filter((r) => r[1]).map((r) => line(r[0], r[1]))];
    tbl.push(`Hi ${f(d.high)}  Lo ${f(d.low)}  Open ${f(d.open)}`);

    // naked level terdekat
    const nk: { name: string; price: number }[] = [];
    for (const p of P.items) {
      if (!p.valid) continue;
      for (const k of KEYS) if (!p.touch[k]) nk.push({ name: `n${k} ${p.name}`, price: { POC: p.poc, VAH: p.vah, VAL: p.val }[k] as number });
    }
    const near = nk.filter((n) => cfg.level_atr <= 0 || Math.abs(n.price - s.price) <= cfg.level_atr * atr)
      .sort((a, b2) => Math.abs(a.price - s.price) - Math.abs(b2.price - s.price)).slice(0, cfg.max_naked);
    if (near.length) {
      const nw = Math.max(...near.map((n) => n.name.length));
      tbl.push('', `naked${cfg.level_atr > 0 ? ` ±${cfg.level_atr} ATR` : ''}`,
        ...near.map((n) => `${n.name.padEnd(nw)}  ${f(n.price).padStart(cw)}  ${sg(n.price - s.price).padStart(cw)}  ${(Math.abs(n.price - s.price) / atr).toFixed(1)}×`));
    }
    L.push(`<pre>${esc(tbl.join('\n'))}</pre>`);
    return L.join('\n');
  });

  const out: string[] = [];
  let cur = head;
  for (const b of blocks) {
    if (cur.length + b.length + 2 > LIMIT) { out.push(cur); cur = b; } else cur += '\n\n' + b;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------- pengiriman
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendText(token: string, chat: string, text: string, retry = true): Promise<void> {
  let j: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } = {};
  let status = 0;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    status = r.status;
    j = (await r.json().catch(() => ({}))) as typeof j;
  } catch (e) {
    throw new Error(`tidak bisa menghubungi Telegram: ${(e as Error).message.split(token).join('***')}`);
  }
  if (j.ok) return;
  const wait = j.parameters?.retry_after;
  if (retry && status === 429 && wait && wait <= 30) { await sleep(wait * 1000 + 200); return sendText(token, chat, text, false); }
  throw new Error(`Telegram menolak: ${(j.description ?? `HTTP ${status}`).split(token).join('***')}`);
}

// ---------------------------------------------------------------- pemicu otomatis
type Layers = Record<Layer, string>;
type State = Record<string, Layers>;
const LAYER_NAME: Record<Layer, string> = { base: 'dasar', close: 'close', live: 'realtime' };

export interface SnapMsg { meta: { ts: number }; data: Snap | null }
export interface TgStatus {
  configured: boolean; enabled: boolean; chat: string | null; sent: number;
  last_sent: string | null; last_reason: string | null; last_error: string | null; settings: TgSettings;
}

export class Notifier {
  settings: TgSettings = { ...DEFAULTS };
  private raw: Record<string, unknown> = {};
  private mtime = -1;
  private ref: State | null = null;            // keadaan saat pesan terakhir (atau saat start)
  private curSig = ''; private curSince = 0;   // keadaan sekarang dan sejak kapan bertahan
  private starts: Record<string, number> = {};
  private pend = new Set<string>(); private pendSince = 0;
  private lastSent = 0; private retryAt = 0; private busy = false;
  private sent = 0; private lastAt: string | null = null; private lastReason: string | null = null; private lastError: string | null = null;

  constructor(private file: string, private getSnap: () => SnapMsg | null, private log: (m: string) => void = console.log) {}

  private reload(): void {
    let st: fs.Stats;
    try { st = fs.statSync(this.file); } catch { this.raw = {}; this.mtime = -1; this.settings = { ...DEFAULTS }; return; }
    if (st.mtimeMs === this.mtime) return;
    this.mtime = st.mtimeMs;
    try {
      this.raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      this.settings = sanitize(this.raw);
      this.lastError = null;
    } catch (e) { this.lastError = `telegram.json ditolak: ${(e as Error).message}`; this.log(`[telegram] ${this.lastError}`); }
  }
  private creds(): { token: string; chat: string } | null {
    const token = process.env.TG_TOKEN || (typeof this.raw.token === 'string' ? this.raw.token : '');
    const chat = process.env.TG_CHAT_ID || (this.raw.chat_id != null ? String(this.raw.chat_id) : '');
    return token && chat && !token.startsWith('123456:ABC') ? { token, chat } : null;
  }

  status(): TgStatus {
    this.reload();
    const c = this.creds();
    return { configured: !!c, enabled: this.settings.enabled, chat: c ? `…${c.chat.slice(-4)}` : null, sent: this.sent,
      last_sent: this.lastAt, last_reason: this.lastReason, last_error: this.lastError, settings: this.settings };
  }

  saveSettings(body: string): void {
    const incoming = JSON.parse(body) as Record<string, unknown>;
    const next = sanitize(incoming);                                    // lempar error bila tidak valid
    this.reload();
    const out = { ...this.raw };
    for (const k of Object.keys(out)) if (!SECRET.has(k) && !k.startsWith('_')) delete out[k];   // ganti pengaturan, pertahankan token/chat_id/_help
    Object.assign(out, next);
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(out, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.reload();
  }

  private async deliver(texts: string[]): Promise<void> {
    const c = this.creds();
    if (!c) throw new Error('token / chat_id belum diisi (telegram.json atau env TG_TOKEN, TG_CHAT_ID)');
    for (const t of texts) await sendText(c.token, c.chat, t);
  }
  private mark(reason: string, at?: number): void {          // `at` hanya diisi untuk pesan otomatis (mengatur jeda minimum)
    this.sent++; this.lastAt = new Date().toLocaleString('sv-SE'); this.lastReason = reason; this.lastError = null;
    if (at != null) this.lastSent = at;
  }

  async sendManual(): Promise<void> {
    this.reload();
    const m = this.getSnap();
    if (!m?.data) throw new Error('belum ada data dari engine');
    await this.deliver(buildMessages(m.data, this.settings, ['Manual']));
    this.mark('Manual');
  }
  async sendTest(): Promise<void> {
    await this.deliver([`✅ <b>TPO Context</b> terhubung · ${new Date().toLocaleString('sv-SE')}`]);
    this.mark('Test');
  }

  private state(s: Snap): State {
    const fb = fullBias(s, decimalsOf(s.point), ORDER.filter((t) => this.settings.profiles.includes(t)));
    const st: State = {};
    fb.tags.forEach((t, i) => {
      const b = fb.live[i], c = fb.closed[i];
      st[t] = { base: b ? b.label : 'N/A', close: c ? EFF[c.eff] : '–', live: b ? EFF[b.eff] : 'N/A' };
    });
    return st;
  }
  private sig(st: State): string { return JSON.stringify(Object.entries(st).map(([t, l]) => [t, ...this.settings.watch.map((w) => l[w])])); }
  private diff(a: State, b: State): string[] {
    const out: string[] = [];
    for (const t of Object.keys(b)) for (const w of this.settings.watch) if (a[t] && a[t][w] !== b[t][w]) out.push(`${t} ${LAYER_NAME[w]}: ${a[t][w]}→${b[t][w]}`);
    return out;
  }

  // Dipanggil tiap detik. `now` dalam detik (bisa disuntik saat tes).
  async tick(now = Date.now() / 1000): Promise<void> {
    if (this.busy) return;
    this.reload();
    const m = this.getSnap();
    if (!m?.data || now - m.meta.ts > 30) return;                      // engine mati / belum siap: jangan memicu apa pun
    const s = m.data, cfg = this.settings;
    const cur = this.state(s);
    const starts: Record<string, number> = {};
    for (const t of Object.keys(cur)) starts[t] = s.profiles[t].developing?.start ?? 0;

    if (!this.ref) {                                                    // kondisi awal = acuan; tidak mengirim apa pun
      this.ref = cur; this.curSig = this.sig(cur); this.curSince = now; this.starts = starts;
      if (cfg.enabled && cfg.send_on_start) await this.fire(['Start dashboard'], s, cur);
      return;
    }
    for (const t of cfg.on_new_period) {
      if (starts[t] != null && this.starts[t] != null && starts[t] !== this.starts[t]) { this.pend.add(t); if (!this.pendSince) this.pendSince = now; }
    }
    this.starts = { ...this.starts, ...starts };

    const sg = this.sig(cur);
    if (sg !== this.curSig) { this.curSig = sg; this.curSince = now; }

    if (!cfg.enabled) { this.ref = cur; this.pend.clear(); this.pendSince = 0; return; }   // mati: pantau diam-diam, tanpa tunggakan
    if (now < this.retryAt) return;

    const changeDue = cfg.on_change && sg !== this.sig(this.ref) && now - this.curSince >= cfg.confirm_sec && now - this.lastSent >= cfg.min_interval_sec;
    const periodDue = this.pend.size > 0 && now - this.pendSince >= cfg.confirm_sec;
    if (!changeDue && !periodDue) return;

    const reasons: string[] = [];
    if (periodDue) reasons.push(`Periode baru: ${[...this.pend].join(' ')}`);
    if (changeDue) reasons.push(...this.diff(this.ref, cur));
    await this.fire(reasons, s, cur, now);
  }

  private async fire(reasons: string[], s: Snap, cur: State, now = Date.now() / 1000): Promise<void> {
    this.busy = true;
    try {
      await this.deliver(buildMessages(s, this.settings, reasons));
      this.mark(reasons.join('; '), now);
      this.ref = cur; this.pend.clear(); this.pendSince = 0;
      this.log(`[telegram] terkirim: ${reasons.join('; ')}`);
    } catch (e) {
      this.lastError = (e as Error).message; this.retryAt = now + 60;     // coba lagi 1 menit kemudian
      this.log(`[telegram] gagal: ${this.lastError}`);
    } finally { this.busy = false; }
  }
}
