// ChartApp — orchestrator: init canvases, renderers, data, interaction
import { BarBuffer } from './data.js';
import { Viewport } from './viewport.js';
import { initGL } from './gl.js';
import type { GLCtx } from './gl.js';
import { CandleRenderer } from './candles.js';
import { VolumeRenderer } from './volume.js';
import { GridRenderer } from './grid.js';
import { AxisRenderer } from './axis.js';
import { CrosshairRenderer } from './crosshair.js';
import { TpoRenderer } from './tpo.js';
import { PanZoom } from './panzoom.js';
import { ChartClient } from './client.js';
import { fmtPrice, fmtPct, decimalsOf } from './util.js';

export class ChartApp {
  private glCanvas!: HTMLCanvasElement;
  private ovCanvas!: HTMLCanvasElement;
  private yCanvas!: HTMLCanvasElement;
  private xCanvas!: HTMLCanvasElement;
  private ovCtx!: CanvasRenderingContext2D;
  private yCtx!: CanvasRenderingContext2D;
  private xCtx!: CanvasRenderingContext2D;
  private infoEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private dotEl!: HTMLElement;
  private pxEl!: HTMLElement;
  private chgEl!: HTMLElement;
  private btnFollowEl!: HTMLElement;
  private btnTpoEl!: HTMLElement;
  private btnNPocEl!: HTMLElement;

  private glCtx!: GLCtx;
  private vp = new Viewport();
  private bars = new BarBuffer();

  private candles = new CandleRenderer();
  private volume = new VolumeRenderer();
  private grid = new GridRenderer();
  private axis = new AxisRenderer();
  private crosshair = new CrosshairRenderer();
  private tpo = new TpoRenderer();
  private panzoom!: PanZoom;
  private client!: ChartClient;

  private tf = 60; // current timeframe in minutes
  private tickSize = 0.01;
  private openPrice = 0;
  private dirty = true;
  private rafId = 0;

  async init(): Promise<void> {
    // DOM elements
    this.glCanvas = document.getElementById('glCanvas') as HTMLCanvasElement;
    this.ovCanvas = document.getElementById('ovCanvas') as HTMLCanvasElement;
    this.yCanvas = document.getElementById('yCanvas') as HTMLCanvasElement;
    this.xCanvas = document.getElementById('xCanvas') as HTMLCanvasElement;
    this.ovCtx = this.ovCanvas.getContext('2d')!;
    this.yCtx = this.yCanvas.getContext('2d')!;
    this.xCtx = this.xCanvas.getContext('2d')!;
    this.infoEl = document.getElementById('info')!;
    this.statusEl = document.getElementById('status')!;
    this.dotEl = document.getElementById('dot')!;
    this.pxEl = document.getElementById('px')!;
    this.chgEl = document.getElementById('chg')!;
    this.btnFollowEl = document.getElementById('btnFollow')!;
    this.btnTpoEl = document.getElementById('btnTpo')!;
    this.btnNPocEl = document.getElementById('btnNPoc')!;

    // WebGL context first
    this.glCtx = initGL(this.glCanvas);

    // Size canvases (after glCtx is ready)
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.markDirty(); });

    // Client
    this.client = new ChartClient(
      (bars) => { this.bars.load(bars); this.fitAndRender(); },
      (price) => { this.bars.updateLast(price); this.updatePrice(price); this.markDirty(); },
      (connected) => { this.dotEl.className = connected ? 'ok' : ''; },
      (tpoData) => { this.tpo.setData(tpoData); this.markDirty(); },
    );

    // PanZoom with Y-axis drag support
    this.panzoom = new PanZoom(
      document.getElementById('chartMain')!,
      document.getElementById('yAxis')!,
      this.vp,
      () => this.markDirty(),
      (x, y) => { this.crosshair.update(x, y); this.markDirty(); },
      () => { this.crosshair.hide(); this.markDirty(); },
      (follow) => this.updateAutoFollowBtn(follow),
    );

    // Reset view / auto-follow button
    if (this.btnFollowEl) {
      this.btnFollowEl.addEventListener('click', () => this.resetToLive());
    }

    // TPO and nPOC buttons
    if (this.btnTpoEl) {
      this.btnTpoEl.addEventListener('click', () => {
        const mode = this.tpo.toggleProfile();
        this.btnTpoEl.textContent = `📊 TPO: ${mode}`;
        this.btnTpoEl.classList.toggle('on', mode !== 'OFF');
        this.markDirty();
      });
    }
    if (this.btnNPocEl) {
      this.btnNPocEl.addEventListener('click', () => {
        const on = this.tpo.toggleNPOC();
        this.btnNPocEl.classList.toggle('on', on);
        this.markDirty();
      });
    }

    // TF buttons
    document.getElementById('tf')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const tf = parseInt(btn.dataset['tf'] || '60');
      this.switchTf(tf);
    });

    // Keyboard shortcuts
    this.bindKeyboard();

    // Start render loop immediately
    this.renderLoop();

    // Connect WebSocket for live ticks
    this.client.connect();

    // Fetch initial data with auto-retry
    const loadData = async (retry = 0) => {
      this.statusEl.textContent = retry > 0 ? `Menunggu data dari Binance… (${retry})` : 'Memuat data…';
      try {
        const [bars, tpo] = await Promise.all([
          this.client.fetchBars(this.tf),
          this.client.fetchTpo().catch(() => null),
        ]);
        if (tpo) {
          this.tpo.setData(tpo);
        }
        if (bars.length > 0) {
          this.bars.load(bars);
          this.openPrice = bars[0].o;
          this.tickSize = this.detectTickSize(bars);
          this.fitAndRender();
          this.statusEl.textContent = '';
        } else if (retry < 30) {
          setTimeout(() => loadData(retry + 1), 1000);
        } else {
          this.statusEl.textContent = 'Data belum siap, silakan ganti timeframe atau refresh.';
        }
      } catch (e) {
        this.statusEl.textContent = `Gagal memuat: ${e}`;
        if (retry < 15) setTimeout(() => loadData(retry + 1), 1500);
      }
    };
    await loadData();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      switch (e.key) {
        case '1': this.switchTf(1); break;
        case '2': this.switchTf(5); break;
        case '3': this.switchTf(15); break;
        case '4': this.switchTf(60); break;
        case '5': this.switchTf(240); break;
        case '6': this.switchTf(1440); break;
        case 'Home':
          this.resetToLive();
          break;
        case '+':
        case '=':
          this.vp.zoom(1 / 1.15, this.vp.w / 2);
          this.panzoom.setAutoFollow(false);
          this.markDirty();
          break;
        case '-':
        case '_':
          this.vp.zoom(1.15, this.vp.w / 2);
          this.panzoom.setAutoFollow(false);
          this.markDirty();
          break;
        case 'ArrowLeft':
          this.vp.pan(50, 0);
          this.panzoom.setAutoFollow(false);
          this.markDirty();
          break;
        case 'ArrowRight':
          this.vp.pan(-50, 0);
          this.panzoom.setAutoFollow(false);
          this.markDirty();
          break;
        case 'p':
        case 'P': {
          const mode = this.tpo.toggleProfile();
          if (this.btnTpoEl) {
            this.btnTpoEl.textContent = `📊 TPO: ${mode}`;
            this.btnTpoEl.classList.toggle('on', mode !== 'OFF');
          }
          this.markDirty();
          break;
        }
        case 'n':
        case 'N': {
          const on = this.tpo.toggleNPOC();
          if (this.btnNPocEl) {
            this.btnNPocEl.classList.toggle('on', on);
          }
          this.markDirty();
          break;
        }
      }
    });
  }

  private resetToLive(): void {
    if (this.bars.len === 0) return;
    this.vp.autoFitY = true;
    this.vp.scrollToEnd(this.bars.len);
    const [lo, hi] = this.bars.priceRange(Math.max(0, this.vp.xMin), this.vp.xMax);
    if (lo < Infinity) this.vp.fitY(lo, hi);
    this.panzoom.setAutoFollow(true);
    this.updateAutoFollowBtn(true);
    this.markDirty();
  }

  private updateAutoFollowBtn(follow: boolean): void {
    if (this.btnFollowEl) {
      this.btnFollowEl.classList.toggle('hidden', follow);
    }
  }

  private resize(): void {
    const main = document.getElementById('chartMain')!;
    const dpr = window.devicePixelRatio || 1;
    const w = main.clientWidth || 800;
    const h = main.clientHeight || 500;

    this.glCanvas.width = w * dpr;
    this.glCanvas.height = h * dpr;
    this.ovCanvas.width = w * dpr;
    this.ovCanvas.height = h * dpr;

    const yAxis = document.getElementById('yAxis')!;
    this.yCanvas.width = (yAxis.clientWidth || 72) * dpr;
    this.yCanvas.height = (yAxis.clientHeight || h) * dpr;

    const xRow = this.xCanvas.parentElement!;
    this.xCanvas.width = (xRow.clientWidth || w) * dpr;
    this.xCanvas.height = (xRow.clientHeight || 22) * dpr;

    this.vp.setSize(w * dpr, h * dpr);
    if (this.glCtx && this.glCtx.gl) {
      this.glCtx.gl.viewport(0, 0, w * dpr, h * dpr);
    }
  }

  private markDirty(): void { this.dirty = true; }

  private fitAndRender(): void {
    if (this.bars.len === 0) return;
    // Show last 120 bars
    const show = Math.min(this.bars.len, 120);
    this.vp.xMin = this.bars.len - show;
    this.vp.xMax = this.bars.len + 5;
    this.vp.autoFitY = true;
    this.panzoom.setAutoFollow(true);
    this.updateAutoFollowBtn(true);

    // Fit Y to visible data
    const [lo, hi] = this.bars.priceRange(this.vp.xMin, this.vp.xMax);
    this.vp.fitY(lo, hi);

    this.markDirty();
  }

  private async switchTf(tf: number): Promise<void> {
    // Update button states
    document.querySelectorAll('#tf button').forEach(b => {
      (b as HTMLElement).classList.toggle('on', parseInt((b as HTMLElement).dataset['tf'] || '0') === tf);
    });
    this.tf = tf;
    this.client.setTf(tf);
    this.statusEl.textContent = 'Memuat data…';
    try {
      const bars = await this.client.fetchBars(tf);
      this.bars.load(bars);
      if (bars.length > 0) {
        this.openPrice = bars[0].o;
        this.tickSize = this.detectTickSize(bars);
      }
      this.fitAndRender();
      this.statusEl.textContent = '';
    } catch (e) {
      this.statusEl.textContent = `Gagal memuat: ${e}`;
    }
  }

  private updatePrice(price: number): void {
    const dec = decimalsOf(this.tickSize);
    this.pxEl.textContent = fmtPrice(price, dec);
    if (this.openPrice > 0) {
      const diff = price - this.openPrice;
      const pct = (diff / this.openPrice) * 100;
      const bull = diff >= 0;
      this.pxEl.className = 'px ' + (bull ? 'up' : 'dn');
      this.chgEl.textContent = `${bull ? '▲ +' : '▼ '}${Math.abs(diff).toFixed(dec)} (${fmtPct(pct)})`;
      this.chgEl.style.color = bull ? 'var(--bull)' : 'var(--bear)';
    }

    // auto-follow
    if (this.panzoom.autoFollow) {
      this.vp.scrollToEnd(this.bars.len);
      if (this.vp.autoFitY) {
        const [lo, hi] = this.bars.priceRange(Math.max(0, this.vp.xMin), this.vp.xMax);
        if (lo < Infinity) this.vp.fitY(lo, hi);
      }
    }
  }

  private renderLoop = (): void => {
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.renderLoop);
  };

  private render(): void {
    const { glCtx, vp, bars, candles, volume, grid, axis, crosshair } = this;
    const gl = glCtx.gl;

    // Clear WebGL canvas
    gl.clearColor(0.075, 0.09, 0.133, 1.0); // #131722
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (bars.len === 0) return;

    // Fit Y when scrolling/zooming X (only if autoFitY is active)
    if (vp.autoFitY) {
      const [lo, hi] = bars.priceRange(Math.max(0, vp.xMin), vp.xMax);
      if (lo < Infinity) vp.fitY(lo, hi);
    }

    const view = vp.clipView();

    // Draw candles
    candles.rebuild(bars, vp);
    candles.draw(glCtx, view);

    // Draw volume
    volume.rebuild(bars, vp);
    volume.draw(glCtx, view);

    // Draw grid (overlay canvas)
    this.ovCtx.clearRect(0, 0, vp.w, vp.h);
    grid.draw(this.ovCtx, vp, this.tf);

    // Draw TPO overlay (blocks, level lines, separators, nPOC)
    this.tpo.draw(this.ovCtx, vp, bars);

    // Draw crosshair on overlay
    crosshair.draw(this.ovCtx, this.yCtx, this.xCtx, vp, bars, this.tf, this.tickSize);
    crosshair.drawInfo(this.infoEl, bars, vp, this.tickSize, this.tf);

    // Draw axes
    axis.drawY(this.yCtx, vp, this.tickSize, bars.lastPrice(), this.openPrice);
    axis.drawX(this.xCtx, vp, bars, this.tf);

    // Current price horizontal line on overlay
    const lastP = bars.lastPrice();
    if (lastP > 0 && lastP >= vp.yMin && lastP <= vp.yMax) {
      const y = Math.round(vp.yToScreen(lastP)) + 0.5;
      const bull = lastP >= this.openPrice;
      this.ovCtx.save();
      this.ovCtx.strokeStyle = bull ? '#26A69A' : '#EF5350';
      this.ovCtx.lineWidth = 1;
      this.ovCtx.setLineDash([6, 3]);
      this.ovCtx.beginPath();
      this.ovCtx.moveTo(0, y);
      this.ovCtx.lineTo(vp.w, y);
      this.ovCtx.stroke();
      this.ovCtx.restore();
    }
  }

  private detectTickSize(bars: { o: number; h: number; l: number; c: number }[]): number {
    // detect from price precision
    let maxDec = 0;
    for (let i = 0; i < Math.min(bars.length, 20); i++) {
      const b = bars[i];
      for (const p of [b.o, b.h, b.l, b.c]) {
        const s = p.toString();
        const d = s.indexOf('.');
        if (d >= 0) maxDec = Math.max(maxDec, s.length - d - 1);
      }
    }
    return Math.pow(10, -maxDec);
  }
}
