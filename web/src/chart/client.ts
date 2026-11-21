// ChartClient — REST fetch + WebSocket live updates
import type { BarRaw } from './data.js';
import type { ChartTpoData } from './tpo.js';

export type OnBars = (bars: BarRaw[]) => void;
export type OnTick = (price: number) => void;
export type OnStatus = (connected: boolean) => void;
export type OnTpo = (data: ChartTpoData) => void;

export class ChartClient {
  private ws: WebSocket | null = null;
  private tf = 60; // current timeframe in minutes
  private onTpoCallback?: OnTpo;

  constructor(
    private onBars: OnBars,
    private onTick: OnTick,
    private onStatus: OnStatus,
    onTpo?: OnTpo,
  ) {
    this.onTpoCallback = onTpo;
  }

  setTf(tf: number): void { this.tf = tf; }

  async fetchBars(tf: number, count = 500): Promise<BarRaw[]> {
    const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}`);
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
