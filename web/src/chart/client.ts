// ChartClient — REST fetch + WebSocket live updates (+ sumber data alternatif: binance/tv)
import type { BarRaw } from './data.js';
import type { ChartTpoData } from './tpo.js';

export type ChartSource = 'main' | 'binance' | 'tv';
export type OnBars = (bars: BarRaw[]) => void;
/** `wall` = waktu server (epoch detik) saat harga diterima. */
export type OnTick = (price: number, wall: number) => void;
export type OnStatus = (connected: boolean) => void;
/** TPO di server berubah. */
export type OnTpo = () => void;
/** Ada data live yang mungkin terlewat (sambung ulang / klien tertinggal). */
export type OnResync = () => void;
/** Frame chart live dari sumber alternatif: (src, tf, full, bars) */
export type OnChartFrame = (src: string, tf: number, full: boolean, bars: BarRaw[]) => void;

export interface ChartSrcOption { id: string; label: string; symbol: string }
export interface ChartSrcInfo { primary: string; options: ChartSrcOption[] }

export class ChartClient {
  private ws: WebSocket | null = null;
  private opened = false;
  private tf = 60; // current timeframe in minutes
  private source: ChartSource = 'main';
  private onTpoCallback?: OnTpo;
  private onChartCallback?: OnChartFrame;

  constructor(
    private onBars: OnBars,
    private onTick: OnTick,
    private onStatus: OnStatus,
    onTpo?: OnTpo,
    onChart?: OnChartFrame,
    private onResync?: OnResync,
  ) {
    this.onTpoCallback = onTpo;
    this.onChartCallback = onChart;
  }

  setTf(tf: number): void { this.tf = tf; }
  setSource(s: ChartSource): void { this.source = s; }

  /** Daftar pilihan sumber data dari server (label sudah berisi simbol). */
  async fetchInfo(): Promise<ChartSrcInfo> {
    const resp = await fetch('/api/chart-info');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  async fetchBars(tf: number, count = 500, source?: ChartSource, before?: number): Promise<BarRaw[]> {
    const src = source ?? this.source;
    const extra = src && src !== 'main' ? `&source=${src}` : '';
    const older = before !== undefined ? `&before=${before}` : '';
    const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}${extra}${older}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: number[][] = await resp.json();
    return data.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  }

  async fetchTpo(tag: string, since?: number): Promise<ChartTpoData> {
    const url = `/api/chart-tpo?tag=${tag}` + (since !== undefined ? `&since=${since}` : '');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?chart=1`);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus(true);
      if (this.opened) this.onResync?.();
      this.opened = true;
    };
    ws.onclose = () => {
      this.onStatus(false);
      setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.k === 'tick' && typeof msg.p === 'number') {
          this.onTick(msg.p, typeof msg.wall === 'number' ? msg.wall : 0);
        } else if (msg.k === 'chart' && typeof msg.src === 'string' && typeof msg.tf === 'number') {
          const bars: BarRaw[] = (Array.isArray(msg.bars) ? msg.bars : []).map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
          this.onChartCallback?.(msg.src, msg.tf, !!msg.full, bars);
        } else if (msg.k === 'tpo') {
          this.onTpoCallback?.();
        } else if (msg.k === 'resync') {
          this.onResync?.();
        }
      } catch { /* ignore */ }
    };
  }

  disconnect(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
