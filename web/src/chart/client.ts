// ChartClient — REST fetch + WebSocket live updates (+ sumber data alternatif: binance/tv)
import type { BarRaw } from './data.js';
import type { ChartTpoData } from './tpo.js';

export type ChartSource = 'main' | 'binance' | 'tv';
export type OnBars = (bars: BarRaw[]) => void;
export type OnTick = (price: number) => void;
export type OnStatus = (connected: boolean) => void;
export type OnTpo = (data: ChartTpoData) => void;
/** Frame chart live dari sumber alternatif: (src, tf, full, bars) */
export type OnChartFrame = (src: string, tf: number, full: boolean, bars: BarRaw[]) => void;

export interface ChartSrcOption { id: string; label: string }
export interface ChartSrcInfo { primary: string; options: ChartSrcOption[] }

export class ChartClient {
  private ws: WebSocket | null = null;
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

  async fetchBars(tf: number, count = 500, source?: ChartSource): Promise<BarRaw[]> {
    const src = source ?? this.source;
    const extra = src && src !== 'main' ? `&source=${src}` : '';
    const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}${extra}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: number[][] = await resp.json();
    return data.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  }

  async fetchTpo(tag?: string): Promise<ChartTpoData> {
    const url = tag ? `/api/chart-tpo?tag=${tag}` : '/api/chart-tpo';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => this.onStatus(true);
    ws.onclose = () => {
      this.onStatus(false);
      setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.k === 'tick' && typeof msg.p === 'number') {
          this.onTick(msg.p);
        } else if (msg.k === 'chart' && typeof msg.src === 'string' && typeof msg.tf === 'number') {
          const bars: BarRaw[] = (Array.isArray(msg.bars) ? msg.bars : []).map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
          this.onChartCallback?.(msg.src, msg.tf, !!msg.full, bars);
        } else if (msg.s || msg.k === 'meta') {
          // Snapshot baru diterima dari engine -> perbarui TPO
          if (this.onTpoCallback) {
            this.fetchTpo().then(tpo => {
              if (this.onTpoCallback) this.onTpoCallback(tpo);
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    };
  }

  disconnect(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
