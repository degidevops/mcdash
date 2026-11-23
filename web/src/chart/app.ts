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
import {
  DrawingStore,
  DrawingRenderer,
  createDrawing,
  screenXToTime,
  timeToScreenX,
} from './drawing.js';
import type { DrawingType, DrawingPoint, DrawingStyle, Drawing } from './drawing.js';
import { PanZoom } from './panzoom.js';
import { ChartClient } from './client.js';
import type { ChartSource, ChartSrcInfo } from './client.js';
import { fmtPrice, fmtDate, fmtChg, fmtPct, decimalsOf, formatVol } from './util.js';
import { settings } from './settings.js';

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
  private btnFollowEl!: HTMLElement;
  private tfSelEl: HTMLSelectElement | null = null;
  // Panel Indikator (gaya DeepChart: daftar indikator + panel PARAMETER per indikator via gear)
  private btnIndEl: HTMLButtonElement | null = null;
  private indPanelEl: HTMLElement | null = null;
  private indTpoEl: HTMLInputElement | null = null;
  private indNpocEl: HTMLInputElement | null = null;
  private indLettersEl: HTMLInputElement | null = null;
  private indVolEl: HTMLInputElement | null = null;
  private indNoteEl: HTMLElement | null = null;
  private indTpoWrapEl: HTMLElement | null = null;
  private indNpocWrapEl: HTMLElement | null = null;
  private indLettersWrapEl: HTMLElement | null = null;
  private indTpoGearEl: HTMLButtonElement | null = null;
  private indTpoParamsEl: HTMLElement | null = null;
  private indVolGearEl: HTMLButtonElement | null = null;
  private indVolParamsEl: HTMLElement | null = null;
  private segTpoProfileEl: HTMLElement | null = null;
  private rgTpoWEl: HTMLInputElement | null = null;
  private rgTpoWvEl: HTMLElement | null = null;
  private rgVolHEl: HTMLInputElement | null = null;
  private rgVolHvEl: HTMLElement | null = null;
  private rgVolAEl: HTMLInputElement | null = null;
  private rgVolAvEl: HTMLElement | null = null;
  private swVolUpEl: HTMLElement | null = null;
  private swVolDownEl: HTMLElement | null = null;
  private indVolume = true; // indikator Volume (panel bawah) aktif
  private tpoLastProfile = 'S'; // profil TPO terakhir dipilih (utk re-enable cepat)

  // Panel jumlah bar (pill klik → panel pengaturan Data & History, bukan dropdown polos)
  private cntBtnEl: HTMLButtonElement | null = null;
  private cntBtnLabelEl: HTMLElement | null = null;
  private cntPanelEl: HTMLElement | null = null;
  private segCntEl: HTMLElement | null = null;
  private cfgAutoHistEl: HTMLInputElement | null = null;

  // Panel Pengaturan Chart & Candle (gear di toolbar)
  private btnChartSetEl: HTMLButtonElement | null = null;
  private chartPanelEl: HTMLElement | null = null;
  private swCandleUpEl: HTMLElement | null = null;
  private swCandleDownEl: HTMLElement | null = null;
  private segBodyEl: HTMLElement | null = null;
  private cfgGridEl: HTMLInputElement | null = null;
  private cfgCountdownEl: HTMLInputElement | null = null;
  private cfgResetEl: HTMLButtonElement | null = null;

  // Panel pengaturan OBJEK drawing (muncul saat sebuah gambar dipilih)
  private objPanelEl: HTMLElement | null = null;
  private objTitleEl: HTMLElement | null = null;
  private objColorsEl: HTMLElement | null = null;
  private objWidthEl: HTMLElement | null = null;
  private objDashEl: HTMLElement | null = null;
  private objExtendBlockEl: HTMLElement | null = null;
  private objExtendEl: HTMLElement | null = null;
  private objLockEl: HTMLInputElement | null = null;
  private objDeleteEl: HTMLButtonElement | null = null;

  private readonly SWATCH_COLORS = ['#26A69A', '#EF5350', '#2962FF', '#FFD700', '#00BCD4', '#AB47BC', '#FFFFFF'];
  private btnExportEl!: HTMLElement;
  private btnShortcutsEl!: HTMLElement;
  private shortcutsModalEl!: HTMLElement;
  private srcSelEl: HTMLSelectElement | null = null;
  private btnCloseShortcutsEl!: HTMLElement;
  private chartMainEl!: HTMLElement;
  private btnClearDrawingsEl!: HTMLElement;
  private btnDeleteSelectedEl: HTMLButtonElement | null = null;
  private btnDrawColorEl: HTMLButtonElement | null = null;
  private dtColorDotEl: HTMLElement | null = null;

  // Bottom toolbar (gaya DeepChart): toggle TPO/nPOC/Huruf/Volume + switch Live
  private btHintEl: HTMLElement | null = null;
  private btNpocEl: HTMLButtonElement | null = null;
  private btLettersEl: HTMLButtonElement | null = null;
  private btVolEl: HTMLButtonElement | null = null;
  private btLiveEl: HTMLInputElement | null = null;

  private glCtx: GLCtx | null = null;
  private hasWebGL = true;
  private readonly DRAW_COLORS = ['#2962FF', '#EF5350', '#FFD700', '#00BCD4', '#26A69A', '#AB47BC', '#FFFFFF'];
  private vp = new Viewport();
  private bars = new BarBuffer();

  private candles = new CandleRenderer();
  private volume = new VolumeRenderer();
  private grid = new GridRenderer();
  private axis = new AxisRenderer();
  private crosshair = new CrosshairRenderer();
  private tpo = new TpoRenderer();
  private drawingStore = new DrawingStore();
  private drawingRenderer = new DrawingRenderer();
  private panzoom!: PanZoom;
  private client!: ChartClient;

  private symbol = 'XAUUSDT';
  private hoverHit: { drawingId: string; hitType: 'point' | 'body' } | null = null;
  private draggingDrawing: {
    drawingId: string;
    hitType: 'point' | 'body';
    pointIndex?: number;
    startScreenX: number;
    startScreenY: number;
    startPointsScreen: { x: number; y: number }[];
    moved: boolean;
  } | null = null;

  private isInteractingWithDrawing(): boolean {
    return this.drawingStore.activeTool !== null ||
           this.draggingDrawing !== null ||
           this.hoverHit !== null;
  }

  // Track initial press when drawing shapes to support both click-drag and click-click
  private toolPressStart: {
    screenX: number;
    screenY: number;
    time: number;
    price: number;
  } | null = null;

  private tf = 60; // current timeframe in minutes
  private source: ChartSource = 'main'; // sumber data aktif (main = sesuai config server)
  private srcInfo: ChartSrcInfo | null = null;
  private refetchSeq = 0; // pembatal refetch yang sedang berjalan bila ada permintaan lebih baru
  private barCount = 500;        // jumlah bar yang diminta per fetch (panel "Data & History" di header)
  private bufReady = false;      // buffer berisi data (source, tf) aktif — false selama penggantian berjalan
  private loadingOlder = false;  // lazy-load history lebih lama sedang berjalan
  private noMoreHistory = false; // server tidak punya history lebih lama lagi utk (source, tf) aktif
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
    this.btnFollowEl = document.getElementById('btnFollow')!;
    this.tfSelEl = document.getElementById('tfSel') as HTMLSelectElement | null;
    this.btnIndEl = document.getElementById('btnInd') as HTMLButtonElement | null;
    this.indPanelEl = document.getElementById('indPanel');
    this.indTpoEl = document.getElementById('indTpo') as HTMLInputElement | null;
    this.indNpocEl = document.getElementById('indNpoc') as HTMLInputElement | null;
    this.indLettersEl = document.getElementById('indLetters') as HTMLInputElement | null;
    this.indVolEl = document.getElementById('indVol') as HTMLInputElement | null;
    this.indNoteEl = document.getElementById('indNote');
    this.indTpoWrapEl = document.getElementById('indTpoWrap');
    this.indNpocWrapEl = document.getElementById('indNpocWrap');
    this.indLettersWrapEl = document.getElementById('indLettersWrap');
    this.indTpoGearEl = document.getElementById('indTpoGear') as HTMLButtonElement | null;
    this.indTpoParamsEl = document.getElementById('indTpoParams');
    this.indVolGearEl = document.getElementById('indVolGear') as HTMLButtonElement | null;
    this.indVolParamsEl = document.getElementById('indVolParams');
    this.segTpoProfileEl = document.getElementById('segTpoProfile');
    this.rgTpoWEl = document.getElementById('rgTpoW') as HTMLInputElement | null;
    this.rgTpoWvEl = document.getElementById('rgTpoWv');
    this.rgVolHEl = document.getElementById('rgVolH') as HTMLInputElement | null;
    this.rgVolHvEl = document.getElementById('rgVolHv');
    this.rgVolAEl = document.getElementById('rgVolA') as HTMLInputElement | null;
    this.rgVolAvEl = document.getElementById('rgVolAv');
    this.swVolUpEl = document.getElementById('swVolUp');
    this.swVolDownEl = document.getElementById('swVolDown');

    this.cntBtnEl = document.getElementById('cntBtn') as HTMLButtonElement | null;
    this.cntBtnLabelEl = document.getElementById('cntBtnLabel');
    this.cntPanelEl = document.getElementById('cntPanel');
    this.segCntEl = document.getElementById('segCnt');
    this.cfgAutoHistEl = document.getElementById('cfgAutoHist') as HTMLInputElement | null;

    this.btnChartSetEl = document.getElementById('btnChartSet') as HTMLButtonElement | null;
    this.chartPanelEl = document.getElementById('chartPanel');
    this.swCandleUpEl = document.getElementById('swCandleUp');
    this.swCandleDownEl = document.getElementById('swCandleDown');
    this.segBodyEl = document.getElementById('segBody');
    this.cfgGridEl = document.getElementById('cfgGrid') as HTMLInputElement | null;
    this.cfgCountdownEl = document.getElementById('cfgCountdown') as HTMLInputElement | null;
    this.cfgResetEl = document.getElementById('cfgReset') as HTMLButtonElement | null;

    this.objPanelEl = document.getElementById('objPanel');
    this.objTitleEl = document.getElementById('objTitle');
    this.objColorsEl = document.getElementById('objColors');
    this.objWidthEl = document.getElementById('objWidth');
    this.objDashEl = document.getElementById('objDash');
    this.objExtendBlockEl = document.getElementById('objExtendBlock');
    this.objExtendEl = document.getElementById('objExtend');
    this.objLockEl = document.getElementById('objLock') as HTMLInputElement | null;
    this.objDeleteEl = document.getElementById('objDelete') as HTMLButtonElement | null;
    this.btnExportEl = document.getElementById('btnExport')!;
    this.btnShortcutsEl = document.getElementById('btnShortcuts')!;
    this.shortcutsModalEl = document.getElementById('shortcutsModal')!;
    this.btnCloseShortcutsEl = document.getElementById('btnCloseShortcuts')!;
    this.srcSelEl = document.getElementById('srcSel') as HTMLSelectElement | null;
    this.chartMainEl = document.getElementById('chartMain')!;
    this.btnClearDrawingsEl = document.getElementById('btnClearDrawings')!;
    this.btnDeleteSelectedEl = document.getElementById('btnDeleteSelected') as HTMLButtonElement | null;
    this.btnDrawColorEl = document.getElementById('btnDrawColor') as HTMLButtonElement | null;
    this.dtColorDotEl = document.getElementById('dtColorDot');

    // Bottom toolbar (gaya DeepChart: radio TPO + nPOC/Huruf/Volume + switch Live)
    this.btHintEl = document.getElementById('btHint');
    this.btNpocEl = document.getElementById('btNpoc') as HTMLButtonElement | null;
    this.btLettersEl = document.getElementById('btLetters') as HTMLButtonElement | null;
    this.btVolEl = document.getElementById('btVol') as HTMLButtonElement | null;
    this.btLiveEl = document.getElementById('btLive') as HTMLInputElement | null;

    // Drawing storage & interaction
    this.drawingStore.loadFromStorage(this.symbol);
    this.bindDrawingUI();
    this.bindDrawingMouse();
    this.bindDrawingTouch();

    // WebGL context first (with Canvas 2D fallback support)
    try {
      this.glCtx = initGL(this.glCanvas);
      this.hasWebGL = true;
    } catch (err) {
      console.warn('WebGL2 not available, falling back to Canvas 2D renderer:', err);
      this.glCtx = null;
      this.hasWebGL = false;
    }

    // Size canvases (after glCtx is ready)
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.markDirty(); });

    // Dropdown sumber data (main / binance / tradingview)
    if (this.srcSelEl) {
      this.srcSelEl.addEventListener('change', () => {
        this.switchSource((this.srcSelEl as HTMLSelectElement).value as ChartSource);
      });
    }

    // Panel pengaturan jumlah bar (gaya DeepChart: klik pill → panel settingan,
    // bukan dropdown polos). History lebih lama diambil otomatis saat pan kiri (lazy-load)
    // bila opsi "History otomatis" aktif di panel ini.
    try {
      const saved = parseInt(localStorage.getItem('mcdash.chart.count') || '', 10);
      if ([500, 2000, 20000].includes(saved)) this.barCount = saved;
    } catch { /* ignore */ }
    this.updateCntUI();
    if (this.cntBtnEl) {
      this.cntBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePanel(this.cntPanelEl, this.cntBtnEl);
      });
    }
    this.bindSegmented(this.segCntEl, () => String(this.barCount), (v) => {
      const n = parseInt(v, 10);
      if ([500, 2000, 20000].includes(n)) {
        this.barCount = n;
        try { localStorage.setItem('mcdash.chart.count', String(n)); } catch { /* ignore */ }
        this.updateCntUI();
        this.refetchBars();
      }
    });
    if (this.cfgAutoHistEl) {
      this.cfgAutoHistEl.checked = settings.data.autoHistory;
      this.cfgAutoHistEl.addEventListener('change', () => {
        settings.data.autoHistory = this.cfgAutoHistEl!.checked;
        settings.save();
      });
    }

    // Volume ON/OFF dipertahankan antar sesi; OFF → panel volume hilang total
    // (volFrac 0: candle memakai tinggi chart penuh, tanpa garis separator).
    try { this.indVolume = localStorage.getItem('mcdash.chart.vol') !== '0'; } catch { /* ignore */ }
    this.applyVolumeFrac();

    // Klik di luar panel → tutup semua popover pengaturan (kecuali objPanel yang
    // mengikuti seleksi objek drawing).
    document.addEventListener('mousedown', (e) => {
      const t = e.target as Node;
      const pairs: Array<[HTMLElement | null, HTMLElement | null]> = [
        [this.cntPanelEl, this.cntBtnEl],
        [this.chartPanelEl, this.btnChartSetEl],
        [this.indPanelEl, this.btnIndEl],
      ];
      for (const [p, b] of pairs) {
        if (p?.classList.contains('open') && !p.contains(t) && !(b?.contains(t))) {
          p.classList.remove('open');
        }
      }
    });

    // Client
    this.client = new ChartClient(
      (bars) => { this.bars.load(bars); this.fitAndRender(); },
      (price) => {
        if (this.source !== 'main') return; // harga tick WS hanya berlaku utk sumber utama
        this.bars.updateLast(price); this.updatePrice(price); this.markDirty();
      },
      (connected) => { this.dotEl.className = connected ? 'ok' : ''; },
      (tpoData) => { this.tpo.setData(tpoData); this.markDirty(); },
      (src, tf, full, frameBars) => {
        // Frame live dari feed sumber alternatif
        if (src !== this.source || tf !== this.tf) return;
        if (full) {
          const wasEmpty = this.bars.len === 0;
          if (!wasEmpty && frameBars.length < this.bars.len) {
            // Frame "full" hanya tail 150 bar. Buffer lokal berisi history lebih banyak (hasil
            // fetch REST / lazy-load, termasuk bar lama yang server pertahankan) — jangan ditimpa;
            // muat ulang penuh agar bar terbaru fresh tanpa memangkas history yang sudah dimuat.
            this.refetchBars();
            return;
          }
          this.bars.load(frameBars);
          this.bufReady = true;
          this.noMoreHistory = false;
          if (this.openPrice === 0 && frameBars.length > 0) this.openPrice = frameBars[0].o;
          if (wasEmpty) this.fitAndRender();
        } else {
          for (const b of frameBars) this.bars.upsert(b);
          const lp = this.bars.lastPrice();
          if (lp > 0) this.updatePrice(lp);
        }
        this.markDirty();
      },
    );

    // PanZoom with X and Y axis drag & zoom support and double-click auto-fit
    this.panzoom = new PanZoom(
      document.getElementById('chartMain')!,
      document.getElementById('yAxis')!,
      document.getElementById('xAxis')!,
      this.vp,
      () => this.onViewportChanged(),
      (x, y) => { this.crosshair.update(x, y); this.markDirty(); },
      () => { this.crosshair.hide(); this.markDirty(); },
      (follow) => this.updateAutoFollowBtn(follow),
      () => this.isInteractingWithDrawing(),
      () => this.resetToLive(),
    );

    // Live bar timer tick every second for Y-axis countdown
    setInterval(() => {
      if (this.bars.len > 0) this.markDirty();
    }, 1000);

    // Reset view / auto-follow button
    if (this.btnFollowEl) {
      this.btnFollowEl.addEventListener('click', () => this.resetToLive());
    }

    // Panel Indikator (TPO + parameter, Volume + parameter), Panel Pengaturan Chart,
    // dan panel pengaturan objek drawing — gaya DeepChart: tiap fitur punya panel settingan.
    this.bindIndicatorPanel();
    this.bindChartSettingsPanel();
    this.bindObjectPanel();
    this.syncIndicatorPanel();

    // Export screenshot
    if (this.btnExportEl) {
      this.btnExportEl.addEventListener('click', () => this.exportPNG());
    }

    // Shortcuts modal
    if (this.btnShortcutsEl && this.shortcutsModalEl) {
      this.btnShortcutsEl.addEventListener('click', () => {
        this.shortcutsModalEl.classList.add('open');
      });
      if (this.btnCloseShortcutsEl) {
        this.btnCloseShortcutsEl.addEventListener('click', () => {
          this.shortcutsModalEl.classList.remove('open');
        });
      }
      this.shortcutsModalEl.addEventListener('click', (e) => {
        if (e.target === this.shortcutsModalEl) {
          this.shortcutsModalEl.classList.remove('open');
        }
      });
    }

    // TF pill dropdown (gaya DeepChart) + bottom toolbar
    if (this.tfSelEl) {
      this.tfSelEl.value = String(this.tf);
      this.tfSelEl.addEventListener('change', () => {
        const v = parseInt(this.tfSelEl!.value, 10);
        if ([1, 5, 15, 60, 240, 1440].includes(v)) this.switchTf(v);
      });
    }
    this.bindBottomToolbar();

    // Keyboard shortcuts
    this.bindKeyboard();

    // Start render loop immediately
    this.renderLoop();

    // Connect WebSocket for live ticks
    this.client.connect();

    // Muat pilihan sumber data (restorasi pilihan terakhir via localStorage)
    this.loadSourceOptions();

    // Feed sumber alternatif tetap hidup: refresh permintaan tiap 4 menit
    setInterval(() => {
      if (this.source !== 'main') this.client.fetchBars(this.tf, 10).catch(() => {});
    }, 4 * 60 * 1000);

    // Fetch initial data with auto-retry
    const loadData = async () => {
      this.client.fetchTpo().then(tpo => this.tpo.setData(tpo)).catch(() => {});
      await this.refetchBars();
    };
    await loadData();
  }

  // ------------------------------------------------------------ sumber data alternatif

  /** Muat daftar sumber dari server; kembalikan pilihan tersimpan bila masih tersedia. */
  private async loadSourceOptions(): Promise<void> {
    const sel = this.srcSelEl;
    if (!sel) return;
    try {
      const info = await this.client.fetchInfo();
      this.srcInfo = info;
      sel.innerHTML = '';
      for (const opt of info.options) {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      let saved: string | null = null;
      try { saved = localStorage.getItem('mcdash.chart.src'); } catch { /* ignore */ }
      this.updateSymbolForSource('main');
      if (saved && saved !== 'main' && info.options.some(o => o.id === saved)) {
        sel.value = saved;
        this.switchSource(saved as ChartSource);
      }
    } catch { /* server belum siap; dropdown tetap default */ }
  }

  private srcLabel(src: ChartSource): string {
    const opt = this.srcInfo?.options.find(o => o.id === src);
    return opt?.label ?? (src === 'binance' ? 'Binance' : src === 'tv' ? 'TradingView' : 'Sumber utama');
  }

  /** Simbol aktual sumber aktif (mis. OANDA:XAUUSD / XAUUSDT) — dipakai judul kiri atas,
   *  watermark, export PNG, dan kunci penyimpanan drawing. */
  private updateSymbolForSource(src: ChartSource): void {
    const opt = this.srcInfo?.options.find(o => o.id === src);
    if (opt?.symbol) this.setSymbol(opt.symbol);
  }

  /** Ganti simbol tampilan; migrasi drawing lama (era simbol statis XAUUSDT) sekali saja.
   *  Simbol tampil di data window kiri-atas (via drawInfo) & pill sumber di header. */
  private setSymbol(sym: string): void {
    if (!sym) return;
    this.symbol = sym;
    try {
      const key = `mcdash_chart_drawings_${sym.toUpperCase()}`;
      if (!localStorage.getItem(key)) {
        const legacy = localStorage.getItem('mcdash_chart_drawings_XAUUSDT');
        if (legacy) localStorage.setItem(key, legacy);
      }
    } catch { /* ignore */ }
    this.drawingStore.loadFromStorage(sym);
    this.updateDrawingSelectionUI();
    this.markDirty();
  }

  /** Buka/tutup popover panel pengaturan — diposisikan di bawah tombol pemantiknya,
   *  dan menutup popover lain agar hanya satu yang terbuka (kecuali objPanel yang
   *  mengikuti seleksi objek drawing). */
  private togglePanel(panel: HTMLElement | null, anchorBtn: HTMLElement | null, open?: boolean): void {
    if (!panel) return;
    const willOpen = open ?? !panel.classList.contains('open');
    if (willOpen) {
      for (const p of [this.cntPanelEl, this.chartPanelEl, this.indPanelEl]) {
        if (p && p !== panel) p.classList.remove('open');
      }
      if (anchorBtn) {
        const r = anchorBtn.getBoundingClientRect();
        panel.style.top = `${r.bottom + 6}px`;
        const width = 268;
        const rightSpace = Math.max(8, window.innerWidth - r.right);
        panel.style.right = `${Math.min(rightSpace, Math.max(8, window.innerWidth - width - 8))}px`;
        panel.style.left = 'auto';
      }
    }
    panel.classList.toggle('open', willOpen);
  }

  private toggleIndicatorPanel(open?: boolean): void {
    if (open ?? true) this.syncIndicatorPanel();
    this.togglePanel(this.indPanelEl, this.btnIndEl, open);
  }

  private toggleChartPanel(open?: boolean): void {
    this.togglePanel(this.chartPanelEl, this.btnChartSetEl, open);
  }

  private closeAllPopovers(): void {
    for (const p of [this.cntPanelEl, this.chartPanelEl, this.indPanelEl]) p?.classList.remove('open');
  }

  private anyPopoverOpen(): boolean {
    return !!(this.cntPanelEl?.classList.contains('open')
      || this.chartPanelEl?.classList.contains('open')
      || this.indPanelEl?.classList.contains('open'));
  }

  /** Bind kontrol segmented (.cfg-seg): klik tombol → setVal + tanda aktif 'on'. */
  private bindSegmented(seg: HTMLElement | null, getVal: () => string, setVal: (v: string) => void): void {
    if (!seg) return;
    seg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn || !seg.contains(btn)) return;
      setVal(btn.dataset['val'] ?? '');
      this.syncSegmented(seg, getVal());
    });
    this.syncSegmented(seg, getVal());
  }

  private syncSegmented(seg: HTMLElement | null, val: string): void {
    if (!seg) return;
    seg.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('on', (btn as HTMLElement).dataset['val'] === val);
    });
  }

  /** Bangun deretan swatch warna (.cfg-sw) dari daftar warna standar. */
  private buildSwatches(container: HTMLElement | null, getVal: () => string, setVal: (c: string) => void): void {
    if (!container) return;
    container.innerHTML = '';
    for (const c of this.SWATCH_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw';
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => {
        setVal(c);
        this.syncSwatches(container, getVal());
      });
      container.appendChild(b);
    }
    this.syncSwatches(container, getVal());
  }

  private syncSwatches(container: HTMLElement | null, val: string): void {
    if (!container) return;
    container.querySelectorAll('.sw').forEach(btn => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).title.toLowerCase() === val.toLowerCase());
    });
  }

  /** Label pill jumlah bar di header + segmented di panel Data & History. */
  private updateCntUI(): void {
    if (this.cntBtnLabelEl) {
      this.cntBtnLabelEl.textContent = `${this.barCount.toLocaleString('id-ID')} bar`;
    }
    this.syncSegmented(this.segCntEl, String(this.barCount));
  }

  /** Volume ON/OFF — OFF berarti panel volume hilang TOTAL dari chart. */
  private setVolume(on: boolean): void {
    this.indVolume = on;
    try { localStorage.setItem('mcdash.chart.vol', on ? '1' : '0'); } catch { /* ignore */ }
    this.applyVolumeFrac();
    this.syncIndicatorPanel();
    this.markDirty();
  }

  /** volFrac viewport: 0 saat volume OFF (chart penuh), sebaliknya tinggi dari settings. */
  private applyVolumeFrac(): void {
    this.vp.volFrac = this.indVolume ? settings.data.volumeHeight : 0;
  }

  private bindIndicatorPanel(): void {
    if (this.btnIndEl) {
      this.btnIndEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.syncIndicatorPanel();
        this.togglePanel(this.indPanelEl, this.btnIndEl);
      });
    }
    // Gear: buka/tutup bagian parameter per indikator (gaya panel settings DeepChart)
    if (this.indTpoGearEl) {
      this.indTpoGearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.indTpoParamsEl?.classList.toggle('open');
        this.indTpoGearEl!.classList.toggle('on');
      });
    }
    if (this.indVolGearEl) {
      this.indVolGearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.indVolParamsEl?.classList.toggle('open');
        this.indVolGearEl!.classList.toggle('on');
      });
    }
    if (this.indTpoEl) {
      this.indTpoEl.addEventListener('change', () => {
        if (this.source !== 'main') { this.syncIndicatorPanel(); return; }
        this.tpo.setProfile(this.indTpoEl!.checked ? this.tpoLastProfile : null);
        this.syncIndicatorPanel();
        this.markDirty();
      });
    }
    // Profil TPO via segmented S/D/W/M
    this.bindSegmented(this.segTpoProfileEl, () => (this.tpo.activeTag ?? this.tpoLastProfile ?? 'S'), (v) => {
      if (this.source !== 'main') return;
      this.tpoLastProfile = v;
      this.tpo.setProfile(v);
      this.syncIndicatorPanel();
      this.markDirty();
    });
    if (this.indNpocEl) {
      this.indNpocEl.addEventListener('change', () => {
        if (this.source !== 'main') { this.syncIndicatorPanel(); return; }
        this.tpo.setNPOC(this.indNpocEl!.checked);
        this.markDirty();
      });
    }
    if (this.indLettersEl) {
      this.indLettersEl.addEventListener('change', () => {
        if (this.source !== 'main') { this.syncIndicatorPanel(); return; }
        this.tpo.setLetters(this.indLettersEl!.checked);
        this.markDirty();
      });
    }
    if (this.indVolEl) {
      this.indVolEl.addEventListener('change', () => {
        this.setVolume(this.indVolEl!.checked);
      });
    }
    // Parameter TPO: lebar histogram
    if (this.rgTpoWEl) {
      this.rgTpoWEl.addEventListener('input', () => {
        settings.data.tpoWidth = parseInt(this.rgTpoWEl!.value, 10) / 100;
        if (this.rgTpoWvEl) this.rgTpoWvEl.textContent = `${this.rgTpoWEl!.value}%`;
        settings.save();
        this.markDirty();
      });
    }
    // Parameter Volume: tinggi panel, opasitas, warna
    if (this.rgVolHEl) {
      this.rgVolHEl.addEventListener('input', () => {
        settings.data.volumeHeight = parseInt(this.rgVolHEl!.value, 10) / 100;
        if (this.rgVolHvEl) this.rgVolHvEl.textContent = `${this.rgVolHEl!.value}%`;
        settings.save();
        this.applyVolumeFrac();
        this.markDirty();
      });
    }
    if (this.rgVolAEl) {
      this.rgVolAEl.addEventListener('input', () => {
        settings.data.volumeAlpha = parseInt(this.rgVolAEl!.value, 10) / 100;
        if (this.rgVolAvEl) this.rgVolAvEl.textContent = `${this.rgVolAEl!.value}%`;
        settings.save();
        this.markDirty();
      });
    }
    this.buildSwatches(this.swVolUpEl, () => settings.data.volumeUp, (c) => {
      settings.data.volumeUp = c; settings.save(); this.markDirty();
    });
    this.buildSwatches(this.swVolDownEl, () => settings.data.volumeDown, (c) => {
      settings.data.volumeDown = c; settings.save(); this.markDirty();
    });
  }

  /** Panel Pengaturan Chart & Candle (gear di toolbar — Shortcut S). */
  private bindChartSettingsPanel(): void {
    if (this.btnChartSetEl) {
      this.btnChartSetEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePanel(this.chartPanelEl, this.btnChartSetEl);
      });
    }
    this.buildSwatches(this.swCandleUpEl, () => settings.data.candleUp, (c) => {
      settings.data.candleUp = c; settings.save(); this.markDirty();
    });
    this.buildSwatches(this.swCandleDownEl, () => settings.data.candleDown, (c) => {
      settings.data.candleDown = c; settings.save(); this.markDirty();
    });
    this.bindSegmented(this.segBodyEl, () => String(settings.data.bodyWidth), (v) => {
      const n = parseFloat(v);
      if (!isNaN(n)) {
        settings.data.bodyWidth = n;
        settings.save();
        this.markDirty();
      }
    });
    if (this.cfgGridEl) {
      this.cfgGridEl.checked = settings.data.showGrid;
      this.cfgGridEl.addEventListener('change', () => {
        settings.data.showGrid = this.cfgGridEl!.checked;
        settings.save();
        this.markDirty();
      });
    }
    if (this.cfgCountdownEl) {
      this.cfgCountdownEl.checked = settings.data.showCountdown;
      this.cfgCountdownEl.addEventListener('change', () => {
        settings.data.showCountdown = this.cfgCountdownEl!.checked;
        settings.save();
        this.markDirty();
      });
    }
    if (this.cfgResetEl) {
      this.cfgResetEl.addEventListener('click', () => {
        settings.reset();
        this.applyVolumeFrac();
        this.syncSettingsUI();
        this.markDirty();
      });
    }
  }

  /** Sinkronkan semua kontrol yang dibawa settings (chart, volume, TPO, auto-history). */
  private syncSettingsUI(): void {
    this.syncSwatches(this.swCandleUpEl, settings.data.candleUp);
    this.syncSwatches(this.swCandleDownEl, settings.data.candleDown);
    this.syncSegmented(this.segBodyEl, String(settings.data.bodyWidth));
    if (this.cfgGridEl) this.cfgGridEl.checked = settings.data.showGrid;
    if (this.cfgCountdownEl) this.cfgCountdownEl.checked = settings.data.showCountdown;
    if (this.cfgAutoHistEl) this.cfgAutoHistEl.checked = settings.data.autoHistory;
    if (this.rgTpoWEl) {
      this.rgTpoWEl.value = String(Math.round(settings.data.tpoWidth * 100));
      if (this.rgTpoWvEl) this.rgTpoWvEl.textContent = `${Math.round(settings.data.tpoWidth * 100)}%`;
    }
    if (this.rgVolHEl) {
      this.rgVolHEl.value = String(Math.round(settings.data.volumeHeight * 100));
      if (this.rgVolHvEl) this.rgVolHvEl.textContent = `${Math.round(settings.data.volumeHeight * 100)}%`;
    }
    if (this.rgVolAEl) {
      this.rgVolAEl.value = String(Math.round(settings.data.volumeAlpha * 100));
      if (this.rgVolAvEl) this.rgVolAvEl.textContent = `${Math.round(settings.data.volumeAlpha * 100)}%`;
    }
    this.syncSwatches(this.swVolUpEl, settings.data.volumeUp);
    this.syncSwatches(this.swVolDownEl, settings.data.volumeDown);
  }

  /** Sinkronkan isi panel Indikator dengan state renderer (TPO/nPOC/huruf/volume). */
  private syncIndicatorPanel(): void {
    const tpoOn = this.tpo.activeTag !== null;
    if (tpoOn) this.tpoLastProfile = this.tpo.activeTag!;
    if (this.indTpoEl) this.indTpoEl.checked = tpoOn;
    this.syncSegmented(this.segTpoProfileEl, this.tpo.activeTag ?? this.tpoLastProfile);
    if (this.indNpocEl) this.indNpocEl.checked = this.tpo.showNPOC;
    if (this.indLettersEl) this.indLettersEl.checked = this.tpo.showLetters;
    if (this.indVolEl) this.indVolEl.checked = this.indVolume;
    const ext = this.source !== 'main';
    for (const el of [this.indTpoWrapEl, this.indNpocWrapEl, this.indLettersWrapEl]) {
      el?.classList.toggle('off', ext);
    }
    if (this.indTpoEl) this.indTpoEl.disabled = ext;
    if (this.indTpoGearEl) this.indTpoGearEl.disabled = ext;
    if (this.indNpocEl) this.indNpocEl.disabled = ext;
    if (this.indLettersEl) this.indLettersEl.disabled = ext;
    this.segTpoProfileEl?.querySelectorAll('button').forEach(b => {
      (b as HTMLButtonElement).disabled = ext;
    });
    if (this.rgTpoWEl) this.rgTpoWEl.disabled = ext;
    if (this.indNoteEl) {
      this.indNoteEl.textContent = ext
        ? 'TPO hanya dihitung untuk sumber utama.'
        : 'TPO & nPOC dihitung dari sumber utama.';
    }
    this.syncSettingsUI();
    this.syncBottomToolbar();
  }

  /** Binding bottom toolbar (gaya DeepChart): radio profil TPO + nPOC/Huruf/Volume + switch Live. */
  private bindBottomToolbar(): void {
    document.querySelectorAll<HTMLButtonElement>('.btg[data-btpo]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.source !== 'main') return; // TPO hanya utk sumber utama
        const tag = btn.dataset['btpo'] as string;
        this.tpo.setProfile(this.tpo.activeTag === tag ? null : tag); // klik aktif = OFF
        this.syncIndicatorPanel();
        this.markDirty();
      });
    });
    if (this.btNpocEl) {
      this.btNpocEl.addEventListener('click', () => {
        if (this.source !== 'main') return;
        this.tpo.setNPOC(!this.tpo.showNPOC);
        this.syncIndicatorPanel();
        this.markDirty();
      });
    }
    if (this.btLettersEl) {
      this.btLettersEl.addEventListener('click', () => {
        if (this.source !== 'main') return;
        this.tpo.setLetters(!this.tpo.showLetters);
        this.syncIndicatorPanel();
        this.markDirty();
      });
    }
    if (this.btVolEl) {
      this.btVolEl.addEventListener('click', () => {
        this.setVolume(!this.indVolume);
      });
    }
    if (this.btLiveEl) {
      this.btLiveEl.addEventListener('change', () => {
        if (this.btLiveEl!.checked) {
          this.resetToLive();
        } else {
          this.panzoom.setAutoFollow(false);
          this.updateAutoFollowBtn(false);
        }
      });
    }
  }

  /** Sinkronkan tombol bottom toolbar dengan state renderer (dipanggil bersama panel Indikator). */
  private syncBottomToolbar(): void {
    const ext = this.source !== 'main';
    document.querySelectorAll<HTMLButtonElement>('.btg[data-btpo]').forEach(btn => {
      btn.classList.toggle('on', this.tpo.activeTag === (btn.dataset['btpo'] ?? ''));
      btn.disabled = ext;
    });
    if (this.btNpocEl) {
      this.btNpocEl.classList.toggle('on', this.tpo.showNPOC);
      this.btNpocEl.disabled = ext;
    }
    if (this.btLettersEl) {
      this.btLettersEl.classList.toggle('on', this.tpo.showLetters);
      this.btLettersEl.disabled = ext;
    }
    if (this.btVolEl) this.btVolEl.classList.toggle('on', this.indVolume);
    if (this.btLiveEl && this.panzoom) this.btLiveEl.checked = this.panzoom.autoFollow;
  }

  private updateSourceUI(): void {
    // TPO dihitung dari sumber utama — panel indikator & bottom toolbar menonaktifkan setelannya
    this.syncIndicatorPanel();
  }

  private async switchSource(src: ChartSource): Promise<void> {
    if (src === this.source) return;
    this.source = src;
    this.client.setSource(src);
    if (this.srcSelEl) this.srcSelEl.value = src;
    try { localStorage.setItem('mcdash.chart.src', src); } catch { /* ignore */ }
    this.updateSymbolForSource(src);
    this.updateSourceUI();
    await this.refetchBars();
  }

  /** Muat ulang bar utk (source, tf) aktif dengan retry — feed alternatif butuh waktu spawn. */
  private async refetchBars(): Promise<void> {
    const seq = ++this.refetchSeq;
    this.bufReady = false; // tahan lazy-load selama pengambilan berjalan
    this.noMoreHistory = false;
    const lbl = this.source === 'main' ? '' : this.srcLabel(this.source);
    this.statusEl.textContent = lbl ? `Memuat data ${lbl}…` : 'Memuat data…';
    for (let retry = 0; retry <= 30; retry++) {
      try {
        const bars = await this.client.fetchBars(this.tf, this.barCount);
        if (seq !== this.refetchSeq) return;
        if (bars.length > 0) {
          this.bars.load(bars);
          this.openPrice = bars[0].o;
          this.tickSize = this.detectTickSize(bars);
          this.bufReady = true;
          this.noMoreHistory = bars.length < this.barCount; // kolam lebih kecil dari permintaan = habis
          this.fitAndRender();
          this.statusEl.textContent = '';
          return;
        }
        if (retry === 30) {
          this.statusEl.textContent = 'Data belum siap, silakan ganti timeframe / sumber atau refresh.';
          return;
        }
      } catch (e) {
        if (seq !== this.refetchSeq) return;
        if (retry >= 15) { this.statusEl.textContent = `Gagal memuat: ${e}`; return; }
      }
      await new Promise(r => setTimeout(r, 1000));
      if (seq !== this.refetchSeq) return;
    }
  }

  /** Dipanggil tiap pan/zoom: muat history lebih lama saat tepi kiri panduan mendekati tepi data. */
  private onViewportChanged(): void {
    this.markDirty();
    // History otomatis bisa dimatikan dari panel "Data & History".
    if (settings.data.autoHistory && this.vp.xMin < 10) this.loadOlder();
  }

  /** Lazy-load: ambil `barCount` bar lebih lama dari bar terlama yang sudah ada di buffer,
   *  lalu sisipkan di depan tanpa menggeser tampilan (viewport ikut digeser). */
  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || this.noMoreHistory || !this.bufReady || this.bars.len === 0) return;
    this.loadingOlder = true;
    const tf = this.tf, src = this.source, oldest = this.bars.t[0];
    try {
      const older = await this.client.fetchBars(tf, this.barCount, undefined, oldest);
      if (tf !== this.tf || src !== this.source) return; // pengguna ganti tf/sumber saat menunggu
      if (older.length === 0) {
        this.noMoreHistory = true; // kolam sumber sudah habis di sisi server
        return;
      }
      this.bars.prepend(older);
      // Semua indeks bar bergeser sebanyak jumlah bar baru — geser viewport agar tampilan tetap.
      this.vp.xMin += older.length;
      this.vp.xMax += older.length;
      if (older.length < this.barCount) this.noMoreHistory = true;
      this.markDirty();
    } catch { /* jaringan gagal — dicoba lagi pada pan berikutnya */ } finally {
      this.loadingOlder = false;
    }
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
        case '?':
          if (this.shortcutsModalEl) {
            this.shortcutsModalEl.classList.toggle('open');
          }
          break;
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
          this.onViewportChanged();
          break;
        case 'ArrowRight':
          this.vp.pan(-50, 0);
          this.panzoom.setAutoFollow(false);
          this.onViewportChanged();
          break;
        case 'p':
        case 'P': {
          if (this.source !== 'main') break; // TPO hanya utk sumber utama
          this.tpo.toggleProfile();
          this.syncIndicatorPanel();
          this.markDirty();
          break;
        }
        case 'n':
        case 'N': {
          if (this.source !== 'main') break; // nPOC hanya utk sumber utama
          this.tpo.toggleNPOC();
          this.syncIndicatorPanel();
          this.markDirty();
          break;
        }
        case 'i':
        case 'I':
          this.syncIndicatorPanel();
          this.togglePanel(this.indPanelEl, this.btnIndEl);
          break;
        case 's':
        case 'S':
          this.toggleChartPanel();
          break;
        case 't':
        case 'T':
          this.setTool('trendline');
          break;
        case 'h':
        case 'H':
          this.setTool('hline');
          break;
        case 'l':
        case 'L':
          this.setTool('vline');
          break;
        case 'f':
        case 'F':
          this.setTool('fibonacci');
          break;
        case 'r':
        case 'R':
          this.setTool('rectangle');
          break;
        case 'v':
        case 'V':
          this.setTool(null);
          break;
        case 'Escape':
          if (this.shortcutsModalEl?.classList.contains('open')) {
            this.shortcutsModalEl.classList.remove('open');
          } else if (this.anyPopoverOpen()) {
            this.closeAllPopovers();
          } else if (this.drawingStore.activeTool || this.drawingStore.pendingPoints.length > 0) {
            this.setTool(null);
          } else if (this.drawingStore.selectedId) {
            this.drawingStore.setSelected(null);
            this.updateDrawingSelectionUI();
            this.markDirty();
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (this.drawingStore.selectedId) {
            this.drawingStore.removeDrawing(this.drawingStore.selectedId);
            this.drawingStore.saveToStorage(this.symbol);
            this.updateDrawingSelectionUI();
            this.markDirty();
          }
          break;
      }
    });
  }

  private bindDrawingUI(): void {
    const toolbar = document.getElementById('drawToolbar');
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.dt-btn') as HTMLElement;
        if (!btn) return;
        const tool = btn.dataset['tool'];
        if (tool === 'select') {
          this.setTool(null);
        } else if (tool) {
          this.setTool(tool as DrawingType);
        }
      });
    }

    if (this.btnDeleteSelectedEl) {
      this.btnDeleteSelectedEl.addEventListener('click', () => {
        if (this.drawingStore.selectedId) {
          this.drawingStore.removeDrawing(this.drawingStore.selectedId);
          this.drawingStore.saveToStorage(this.symbol);
          this.updateDrawingSelectionUI();
          this.markDirty();
        }
      });
    }

    if (this.btnDrawColorEl) {
      this.btnDrawColorEl.addEventListener('click', () => {
        this.cycleDrawingColor();
      });
    }

    if (this.btnClearDrawingsEl) {
      this.btnClearDrawingsEl.addEventListener('click', () => {
        this.drawingStore.clearAll();
        this.drawingStore.saveToStorage(this.symbol);
        this.setTool(null);
        this.updateDrawingSelectionUI();
        this.markDirty();
      });
    }

    this.updateDrawingSelectionUI();
  }

  private setTool(tool: DrawingType | null): void {
    this.drawingStore.cancelPending();
    this.drawingStore.setActiveTool(tool);
    this.updateToolbarUI();
    if (this.chartMainEl) {
      this.chartMainEl.style.cursor = tool ? 'crosshair' : 'default';
    }
    this.markDirty();
  }

  private updateToolbarUI(): void {
    const active = this.drawingStore.activeTool;
    const buttons = document.querySelectorAll('#drawToolbar .dt-btn[data-tool]');
    buttons.forEach(btn => {
      const tool = (btn as HTMLElement).dataset['tool'];
      if (!active && tool === 'select') {
        btn.classList.add('on');
      } else if (active && tool === active) {
        btn.classList.add('on');
      } else {
        btn.classList.remove('on');
      }
    });
  }

  private bindDrawingMouse(): void {
    this.chartMainEl.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = this.chartMainEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const screenX = (e.clientX - rect.left) * dpr;
      const screenY = (e.clientY - rect.top) * dpr;

      if (screenY > this.vp.chartH) return;

      const price = this.vp.screenToY(screenY);
      const time = screenXToTime(screenX, this.vp, this.bars);

      if (this.drawingStore.activeTool) {
        e.stopPropagation();
        this.toolPressStart = { screenX, screenY, time, price };
        this.handleToolMouseDown(screenX, screenY, time, price);
        return;
      }

      const hit = this.drawingStore.hitTest(screenX, screenY, this.vp, this.bars);
      if (hit) {
        e.stopPropagation();
        this.drawingStore.setSelected(hit.drawing.id);
        this.updateDrawingSelectionUI();
        const d = hit.drawing;
        const startPointsScreen = d.points.map(pt => ({
          x: timeToScreenX(pt.time, this.vp, this.bars),
          y: d.type === 'vline' ? this.vp.chartH / 2 : this.vp.yToScreen(pt.price),
        }));
        this.draggingDrawing = {
          drawingId: d.id,
          hitType: hit.hitType,
          pointIndex: hit.pointIndex,
          startScreenX: screenX,
          startScreenY: screenY,
          startPointsScreen,
          moved: false,
        };
        this.chartMainEl.style.cursor = 'grabbing';
        this.markDirty();
        return;
      }

      if (this.drawingStore.selectedId) {
        this.drawingStore.setSelected(null);
        this.updateDrawingSelectionUI();
        this.markDirty();
      }
    }, true);

    window.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = this.chartMainEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const screenX = (e.clientX - rect.left) * dpr;
      const screenY = (e.clientY - rect.top) * dpr;
      const isInside = screenX >= 0 && screenX <= rect.width * dpr && screenY >= 0 && screenY <= rect.height * dpr;

      const price = this.vp.screenToY(screenY);
      const time = screenXToTime(screenX, this.vp, this.bars);

      if (this.draggingDrawing) {
        const d = this.drawingStore.getDrawing(this.draggingDrawing.drawingId);
        if (d && !d.locked) {
          const dx = screenX - this.draggingDrawing.startScreenX;
          const dy = screenY - this.draggingDrawing.startScreenY;

          if (this.draggingDrawing.hitType === 'body') {
            for (let i = 0; i < d.points.length; i++) {
              const orig = this.draggingDrawing.startPointsScreen[i];
              if (!orig) continue;
              const newX = orig.x + dx;
              const newY = orig.y + dy;
              d.points[i].time = screenXToTime(newX, this.vp, this.bars);
              if (d.type !== 'vline') {
                d.points[i].price = this.vp.screenToY(newY);
              }
            }
            this.draggingDrawing.moved = true;
            this.chartMainEl.style.cursor = 'grabbing';
            this.markDirty();
          } else if (this.draggingDrawing.hitType === 'point' && this.draggingDrawing.pointIndex !== undefined) {
            const pIdx = this.draggingDrawing.pointIndex;
            if (d.type === 'rectangle' && d.points.length >= 2) {
              const p0 = this.draggingDrawing.startPointsScreen[0];
              const p1 = this.draggingDrawing.startPointsScreen[1];
              if (pIdx === 0) {
                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                d.points[0].price = this.vp.screenToY(p0.y + dy);
              } else if (pIdx === 1) {
                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                d.points[1].price = this.vp.screenToY(p1.y + dy);
              } else if (pIdx === 2) {
                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                d.points[1].price = this.vp.screenToY(p1.y + dy);
              } else if (pIdx === 3) {
                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                d.points[0].price = this.vp.screenToY(p0.y + dy);
              }
            } else if (d.points[pIdx]) {
              const orig = this.draggingDrawing.startPointsScreen[pIdx];
              if (orig) {
                const newX = orig.x + dx;
                const newY = orig.y + dy;
                d.points[pIdx].time = screenXToTime(newX, this.vp, this.bars);
                if (d.type !== 'vline') {
                  d.points[pIdx].price = this.vp.screenToY(newY);
                }
              }
            }
            this.draggingDrawing.moved = true;
            this.chartMainEl.style.cursor = 'crosshair';
            this.markDirty();
          }
        }
        return;
      }

      if (this.drawingStore.activeTool) {
        if (isInside && screenY <= this.vp.chartH) {
          this.drawingStore.previewPoint = { time, price };
          this.markDirty();
        }
        return;
      }

      if (isInside && screenY <= this.vp.chartH) {
        const hit = this.drawingStore.hitTest(screenX, screenY, this.vp, this.bars);
        this.hoverHit = hit ? { drawingId: hit.drawing.id, hitType: hit.hitType } : null;
        if (hit) {
          this.chartMainEl.style.cursor = hit.hitType === 'point' ? 'pointer' : 'move';
        } else {
          this.chartMainEl.style.cursor = 'crosshair';
        }
      } else {
        this.hoverHit = null;
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.draggingDrawing) {
        if (this.draggingDrawing.moved) {
          this.drawingStore.saveToStorage(this.symbol);
        }
        this.draggingDrawing = null;
        this.chartMainEl.style.cursor = this.drawingStore.activeTool ? 'crosshair' : 'default';
        this.markDirty();
      }

      // Check if user finished a click-and-drag gesture for multi-point drawing
      if (this.drawingStore.activeTool && this.toolPressStart && this.drawingStore.pendingPoints.length === 1) {
        const rect = this.chartMainEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const screenX = (e.clientX - rect.left) * dpr;
        const screenY = (e.clientY - rect.top) * dpr;
        const dist = Math.hypot(screenX - this.toolPressStart.screenX, screenY - this.toolPressStart.screenY);

        if (dist > 15 * dpr) {
          // Finished drag gesture
          const price = this.vp.screenToY(screenY);
          const time = screenXToTime(screenX, this.vp, this.bars);
          this.finalizeMultiPointDrawing(time, price);
        }
        this.toolPressStart = null;
      }
    });
  }

  /** Touch screen support for drawing tools and selection */
  private bindDrawingTouch(): void {
    this.chartMainEl.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = this.chartMainEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const screenX = (touch.clientX - rect.left) * dpr;
      const screenY = (touch.clientY - rect.top) * dpr;

      if (screenY > this.vp.chartH) return;

      const price = this.vp.screenToY(screenY);
      const time = screenXToTime(screenX, this.vp, this.bars);

      if (this.drawingStore.activeTool) {
        e.preventDefault();
        e.stopPropagation();
        this.toolPressStart = { screenX, screenY, time, price };
        this.handleToolMouseDown(screenX, screenY, time, price);
        return;
      }

      const hit = this.drawingStore.hitTest(screenX, screenY, this.vp, this.bars);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        this.drawingStore.setSelected(hit.drawing.id);
        this.updateDrawingSelectionUI();
        const d = hit.drawing;
        const startPointsScreen = d.points.map(pt => ({
          x: timeToScreenX(pt.time, this.vp, this.bars),
          y: d.type === 'vline' ? this.vp.chartH / 2 : this.vp.yToScreen(pt.price),
        }));
        this.draggingDrawing = {
          drawingId: d.id,
          hitType: hit.hitType,
          pointIndex: hit.pointIndex,
          startScreenX: screenX,
          startScreenY: screenY,
          startPointsScreen,
          moved: false,
        };
        this.markDirty();
      }
    }, { passive: false });

    this.chartMainEl.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = this.chartMainEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const screenX = (touch.clientX - rect.left) * dpr;
      const screenY = (touch.clientY - rect.top) * dpr;

      const price = this.vp.screenToY(screenY);
      const time = screenXToTime(screenX, this.vp, this.bars);

      if (this.draggingDrawing) {
        e.preventDefault();
        const d = this.drawingStore.getDrawing(this.draggingDrawing.drawingId);
        if (d && !d.locked) {
          const dx = screenX - this.draggingDrawing.startScreenX;
          const dy = screenY - this.draggingDrawing.startScreenY;

          if (this.draggingDrawing.hitType === 'body') {
            for (let i = 0; i < d.points.length; i++) {
              const orig = this.draggingDrawing.startPointsScreen[i];
              if (!orig) continue;
              const newX = orig.x + dx;
              const newY = orig.y + dy;
              d.points[i].time = screenXToTime(newX, this.vp, this.bars);
              if (d.type !== 'vline') {
                d.points[i].price = this.vp.screenToY(newY);
              }
            }
            this.draggingDrawing.moved = true;
            this.markDirty();
          } else if (this.draggingDrawing.hitType === 'point' && this.draggingDrawing.pointIndex !== undefined) {
            const pIdx = this.draggingDrawing.pointIndex;
            if (d.type === 'rectangle' && d.points.length >= 2) {
              const p0 = this.draggingDrawing.startPointsScreen[0];
              const p1 = this.draggingDrawing.startPointsScreen[1];
              if (pIdx === 0) {
                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                d.points[0].price = this.vp.screenToY(p0.y + dy);
              } else if (pIdx === 1) {
                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                d.points[1].price = this.vp.screenToY(p1.y + dy);
              } else if (pIdx === 2) {
                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                d.points[1].price = this.vp.screenToY(p1.y + dy);
              } else if (pIdx === 3) {
                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                d.points[0].price = this.vp.screenToY(p0.y + dy);
              }
            } else if (d.points[pIdx]) {
              const orig = this.draggingDrawing.startPointsScreen[pIdx];
              if (orig) {
                const newX = orig.x + dx;
                const newY = orig.y + dy;
                d.points[pIdx].time = screenXToTime(newX, this.vp, this.bars);
                if (d.type !== 'vline') {
                  d.points[pIdx].price = this.vp.screenToY(newY);
                }
              }
            }
            this.draggingDrawing.moved = true;
            this.markDirty();
          }
        }
        return;
      }

      if (this.drawingStore.activeTool && this.drawingStore.pendingPoints.length === 1) {
        e.preventDefault();
        this.drawingStore.previewPoint = { time, price };
        this.markDirty();
      }
    }, { passive: false });

    this.chartMainEl.addEventListener('touchend', (e: TouchEvent) => {
      if (this.draggingDrawing) {
        if (this.draggingDrawing.moved) {
          this.drawingStore.saveToStorage(this.symbol);
        }
        this.draggingDrawing = null;
        this.markDirty();
      }

      if (this.drawingStore.activeTool && this.toolPressStart && this.drawingStore.pendingPoints.length === 1) {
        const touch = e.changedTouches[0];
        if (touch) {
          const rect = this.chartMainEl.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const screenX = (touch.clientX - rect.left) * dpr;
          const screenY = (touch.clientY - rect.top) * dpr;
          const dist = Math.hypot(screenX - this.toolPressStart.screenX, screenY - this.toolPressStart.screenY);

          if (dist > 20 * dpr) {
            const price = this.vp.screenToY(screenY);
            const time = screenXToTime(screenX, this.vp, this.bars);
            this.finalizeMultiPointDrawing(time, price);
          }
        }
        this.toolPressStart = null;
      }
    });
  }

  private handleToolMouseDown(_screenX: number, _screenY: number, time: number, price: number): void {
    const tool = this.drawingStore.activeTool;
    if (!tool) return;

    if (tool === 'hline') {
      const drawing = createDrawing('hline', [{ time, price }], {
        color: this.drawingStore.defaultStyle.color,
        width: 1.5,
        dash: [4, 4],
      });
      this.drawingStore.addDrawing(drawing);
      this.drawingStore.setSelected(drawing.id);
      this.drawingStore.cancelPending();
      this.setTool(null);
      this.updateDrawingSelectionUI();
      this.drawingStore.saveToStorage(this.symbol);
      this.markDirty();
      return;
    }

    if (tool === 'vline') {
      const drawing = createDrawing('vline', [{ time, price }], {
        color: this.drawingStore.defaultStyle.color,
        width: 1.5,
        dash: [4, 4],
      });
      this.drawingStore.addDrawing(drawing);
      this.drawingStore.setSelected(drawing.id);
      this.drawingStore.cancelPending();
      this.setTool(null);
      this.updateDrawingSelectionUI();
      this.drawingStore.saveToStorage(this.symbol);
      this.markDirty();
      return;
    }

    if (this.drawingStore.pendingPoints.length === 0) {
      this.drawingStore.pendingPoints = [{ time, price }];
      this.drawingStore.previewPoint = { time, price };
      this.markDirty();
    } else if (this.drawingStore.pendingPoints.length === 1) {
      this.finalizeMultiPointDrawing(time, price);
    }
  }

  private finalizeMultiPointDrawing(time: number, price: number): void {
    const tool = this.drawingStore.activeTool;
    if (!tool || this.drawingStore.pendingPoints.length === 0) return;

    const p1 = this.drawingStore.pendingPoints[0];
    const p2 = { time, price };

    let style: Partial<DrawingStyle> = { color: this.drawingStore.defaultStyle.color, width: 2 };
    if (tool === 'fibonacci') {
      style = { color: this.drawingStore.defaultStyle.color, width: 1 };
    } else if (tool === 'rectangle') {
      style = { color: this.drawingStore.defaultStyle.color, width: 1.5 };
    } else if (tool === 'trendline') {
      style = { color: this.drawingStore.defaultStyle.color, width: 2 };
    }

    const drawing = createDrawing(tool, [p1, p2], style);
    this.drawingStore.addDrawing(drawing);
    this.drawingStore.setSelected(drawing.id);
    this.drawingStore.cancelPending();
    this.setTool(null);
    this.updateDrawingSelectionUI();
    this.drawingStore.saveToStorage(this.symbol);
    this.markDirty();
  }

  /** Export chart as high-resolution PNG image */
  private exportPNG(): void {
    const totalW = this.ovCanvas.width + this.yCanvas.width;
    const totalH = this.ovCanvas.height + this.xCanvas.height;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = totalW;
    exportCanvas.height = totalH;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // Background #131722
    ctx.fillStyle = '#131722';
    ctx.fillRect(0, 0, totalW, totalH);

    // 1. WebGL Candles and Volume if available
    if (this.hasWebGL && this.glCanvas) {
      ctx.drawImage(this.glCanvas, 0, 0);
    }

    // 2. 2D Overlay (Watermark, Candles Fallback, TPO, Extrema, Drawings, Crosshair)
    ctx.drawImage(this.ovCanvas, 0, 0);

    // 3. Y Axis
    ctx.drawImage(this.yCanvas, this.ovCanvas.width, 0);

    // 4. X Axis
    ctx.drawImage(this.xCanvas, 0, this.ovCanvas.height);

    // 5. Watermark ATAS / MCDash
    ctx.font = 'bold 12px "Inter","Segoe UI",Roboto,Arial,sans-serif';
    ctx.fillStyle = 'rgba(207, 216, 220, 0.75)';
    ctx.textAlign = 'right';
    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
    ctx.fillText(`MCDash • ${this.symbol} • ${this.tfLabel(this.tf)} • ${nowIso} UTC`, totalW - 14, totalH - 10);

    // Trigger download
    const link = document.createElement('a');
    link.download = `mcdash-${this.symbol.toLowerCase()}-${this.tfLabel(this.tf)}-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
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
    if (this.btLiveEl) this.btLiveEl.checked = follow;
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
    this.yCanvas.width = (yAxis.clientWidth || 76) * dpr;
    this.yCanvas.height = (yAxis.clientHeight || h) * dpr;

    const xAxis = document.getElementById('xAxis') || this.xCanvas.parentElement!;
    this.xCanvas.width = (xAxis.clientWidth || w) * dpr;
    this.xCanvas.height = (xAxis.clientHeight || 30) * dpr;

    this.vp.setSize(w * dpr, h * dpr, dpr);
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
    this.tf = tf;
    this.client.setTf(tf);
    if (this.tfSelEl) this.tfSelEl.value = String(tf);
    await this.refetchBars();
  }

  private updatePrice(price: number): void {
    // Harga live tampil di badge teal sumbu Y & data window kiri atas (gaya DeepChart)

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
    const gl = glCtx?.gl;

    if (gl) {
      // Clear WebGL canvas
      gl.clearColor(0.075, 0.09, 0.133, 1.0); // #131722
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Clear overlay canvas
    this.ovCtx.clearRect(0, 0, vp.w, vp.h);

    if (bars.len === 0) return;

    // Fit Y when scrolling/zooming X (only if autoFitY is active)
    if (vp.autoFitY) {
      const [lo, hi] = bars.priceRange(Math.max(0, vp.xMin), vp.xMax);
      if (lo < Infinity) vp.fitY(lo, hi);
    }

    // 1. (tanpa watermark besar — gaya DeepChart: hanya brand kecil kiri-bawah via .brand)

    // 2. Candles & Volume (WebGL if supported, otherwise Canvas 2D fallback)
    if (this.hasWebGL && glCtx) {
      const view = vp.clipView();
      candles.rebuild(bars, vp);
      candles.draw(glCtx, view);

      if (this.indVolume) {
        volume.rebuild(bars, vp);
        volume.draw(glCtx, view);
      }
    } else {
      this.drawCandles2D(vp, bars);
      if (this.indVolume) this.drawVolume2D(vp, bars);
    }

    // 3. Grid lines
    grid.draw(this.ovCtx, vp, this.tf);

    // (marker High/Low & garis ZigZag dihapus — nilai High/Low sudah tampil di
    //  legend OHLC kiri-atas, gaya DeepChart yang bersih tanpa ornamen berlebih)

    // 4. Draw TPO overlay (blocks, level lines, separators, nPOC) — hanya utk sumber utama
    if (this.source === 'main') {
      this.tpo.draw(this.ovCtx, vp, bars);
    }

    // 5. Draw user drawings
    this.drawingRenderer.draw(this.ovCtx, vp, bars, this.drawingStore);

    // 6. Draw axes (clears axis canvases)
    const lastBarTs = bars.len > 0 ? bars.t[bars.len - 1] : 0;
    axis.drawY(this.yCtx, vp, this.tickSize, bars.lastPrice(), this.openPrice, lastBarTs, this.tf);
    axis.drawX(this.xCtx, vp, bars, this.tf);

    // 7. Draw crosshair on overlay and price/time badges on axes (on top of axis labels)
    crosshair.draw(this.ovCtx, this.yCtx, this.xCtx, vp, bars, this.tf, this.tickSize);
    crosshair.drawInfo(this.infoEl, bars, vp, this.tickSize, this.tf, `${this.symbol} · ${this.tfLabel(this.tf)}`);
    this.updateHint();

    // 8. Current price horizontal line on overlay
    const lastP = bars.lastPrice();
    if (lastP > 0 && lastP >= vp.yMin && lastP <= vp.yMax) {
      const y = Math.round(vp.yToScreen(lastP)) + 0.5;
      const bull = lastP >= this.openPrice;
      const dpr = vp.dpr || 1;
      this.ovCtx.save();
      this.ovCtx.strokeStyle = bull ? '#26A69A' : '#EF5350';
      this.ovCtx.lineWidth = 1 * dpr;
      this.ovCtx.setLineDash([6 * dpr, 3 * dpr]);
      this.ovCtx.beginPath();
      this.ovCtx.moveTo(0, y);
      this.ovCtx.lineTo(vp.w, y);
      this.ovCtx.stroke();
      this.ovCtx.restore();
    }
  }

  /** Canvas 2D fallback for candlesticks (used if WebGL2 is not available) */
  private drawCandles2D(vp: Viewport, bars: BarBuffer): void {
    const ctx = this.ovCtx;
    const dpr = vp.dpr || 1;
    const iStart = Math.max(0, Math.floor(vp.xMin) - 1);
    const iEnd = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);

    const candleWidth = Math.max(1, vp.barW * settings.data.bodyWidth * 2);
    const halfW = candleWidth / 2;

    ctx.save();
    for (let i = iStart; i <= iEnd; i++) {
      const o = bars.o[i], h = bars.h[i], l = bars.l[i], c = bars.c[i];
      const x = vp.xToScreen(i);
      const bull = c >= o;
      const color = bull ? settings.data.candleUp : settings.data.candleDown;

      const yO = vp.yToScreen(o);
      const yC = vp.yToScreen(c);
      const yH = vp.yToScreen(h);
      const yL = vp.yToScreen(l);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 1 * dpr);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, Math.round(yH));
      ctx.lineTo(Math.round(x) + 0.5, Math.round(yL));
      ctx.stroke();

      // Body
      const topY = Math.min(yO, yC);
      const bodyH = Math.max(1, Math.abs(yO - yC));
      ctx.fillStyle = color;
      ctx.fillRect(x - halfW, topY, candleWidth, bodyH);
    }
    ctx.restore();
  }

  /** Canvas 2D fallback for volume bars (used if WebGL2 is not available) */
  private drawVolume2D(vp: Viewport, bars: BarBuffer): void {
    const ctx = this.ovCtx;
    const iStart = Math.max(0, Math.floor(vp.xMin) - 1);
    const iEnd = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);

    let maxVol = 0;
    for (let i = iStart; i <= iEnd; i++) {
      if (bars.v[i] > maxVol) maxVol = bars.v[i];
    }
    if (maxVol <= 0) return;

    const volH = vp.chartH * vp.volFrac;
    const candleWidth = Math.max(1, vp.barW * settings.data.bodyWidth * 2);
    const halfW = candleWidth / 2;

    ctx.save();
    for (let i = iStart; i <= iEnd; i++) {
      const x = vp.xToScreen(i);
      const hBar = (bars.v[i] / maxVol) * volH * 0.95;
      const y = vp.h - hBar;
      const bull = bars.c[i] >= bars.o[i];
      ctx.globalAlpha = settings.data.volumeAlpha;
      ctx.fillStyle = bull ? settings.data.volumeUp : settings.data.volumeDown;
      ctx.fillRect(x - halfW, y, candleWidth, hBar);
    }
    ctx.restore();
  }

  /** Petunjuk interaktif di bottom toolbar (saat tool gambar aktif / ada seleksi). */
  private updateHint(): void {
    const el = this.btHintEl;
    if (!el) return;
    if (this.drawingStore.activeTool) {
      const toolTitle = this.toolName(this.drawingStore.activeTool);
      el.textContent = this.drawingStore.pendingPoints.length === 0
        ? `✏️ ${toolTitle}: Sentuh / Klik titik 1 • Esc batal`
        : `✏️ Tarik ke titik 2 untuk menyelesaikan ${toolTitle}`;
    } else if (this.drawingStore.selectedId) {
      el.textContent = `📌 1 gambar dipilih • Del untuk hapus`;
    } else {
      el.textContent = '';
    }
  }

  private updateDrawingSelectionUI(): void {
    const selected = this.drawingStore.selectedId ? this.drawingStore.getDrawing(this.drawingStore.selectedId) : null;
    if (this.btnDeleteSelectedEl) {
      this.btnDeleteSelectedEl.disabled = !selected;
      this.btnDeleteSelectedEl.style.opacity = selected ? '1' : '0.3';
    }
    if (selected && this.dtColorDotEl) {
      this.dtColorDotEl.style.backgroundColor = selected.style.color;
    } else if (this.dtColorDotEl) {
      this.dtColorDotEl.style.backgroundColor = this.drawingStore.defaultStyle.color;
    }
    this.syncObjectPanel();
  }

  // ------------------------------------------------------------ panel pengaturan objek drawing

  /** Objek drawing yang sedang dipilih (bila ada). */
  private selDrawing(): Drawing | undefined {
    return this.drawingStore.selectedId ? this.drawingStore.getDrawing(this.drawingStore.selectedId) : undefined;
  }

  /** Terapkan mutasi style ke objek terpilih: simpan + render ulang + sinkron panel. */
  private applyObjStyle(mut: (d: Drawing) => void): void {
    const d = this.selDrawing();
    if (!d) return;
    mut(d);
    this.drawingStore.saveToStorage(this.symbol);
    if (this.dtColorDotEl) this.dtColorDotEl.style.backgroundColor = d.style.color;
    this.markDirty();
    this.syncObjectPanel();
  }

  /** Panel pengaturan OBJEK drawing — tiap objek punya settingan sendiri
   *  (warna, ketebalan, gaya garis, perpanjang, kunci, hapus). */
  private bindObjectPanel(): void {
    this.buildSwatches(this.objColorsEl, () => this.selDrawing()?.style.color ?? '#2962FF', (c) => {
      this.applyObjStyle((d) => { d.style.color = c; });
    });
    this.bindSegmented(this.objWidthEl, () => {
      const d = this.selDrawing();
      return d ? String(d.style.width) : '2';
    }, (v) => {
      this.applyObjStyle((d) => { d.style.width = parseFloat(v) || 2; });
    });
    this.bindSegmented(this.objDashEl, () => {
      const d = this.selDrawing();
      return d ? dashKeyOf(d.style.dash) : 'solid';
    }, (v) => {
      this.applyObjStyle((d) => { d.style.dash = dashArrayOf(v); });
    });
    this.bindSegmented(this.objExtendEl, () => {
      const d = this.selDrawing();
      return d?.style.extend ?? 'none';
    }, (v) => {
      this.applyObjStyle((d) => { d.style.extend = v as 'none' | 'left' | 'right' | 'both'; });
    });
    if (this.objLockEl) {
      this.objLockEl.addEventListener('change', () => {
        const d = this.selDrawing();
        if (!d) return;
        d.locked = this.objLockEl!.checked;
        this.drawingStore.saveToStorage(this.symbol);
        this.markDirty();
      });
    }
    if (this.objDeleteEl) {
      this.objDeleteEl.addEventListener('click', () => this.deleteSelectedDrawing());
    }
  }

  /** Tampilkan/sembunyikan & isi panel objek sesuai seleksi saat ini. */
  private syncObjectPanel(): void {
    const d = this.selDrawing();
    if (!this.objPanelEl) return;
    this.objPanelEl.classList.toggle('open', !!d);
    if (!d) return;
    if (this.objTitleEl) this.objTitleEl.textContent = this.toolName(d.type).toUpperCase();
    this.syncSwatches(this.objColorsEl, d.style.color);
    this.syncSegmented(this.objWidthEl, String(d.style.width));
    this.syncSegmented(this.objDashEl, dashKeyOf(d.style.dash));
    if (this.objExtendBlockEl) this.objExtendBlockEl.style.display = d.type === 'trendline' ? '' : 'none';
    this.syncSegmented(this.objExtendEl, d.style.extend ?? 'none');
    if (this.objLockEl) this.objLockEl.checked = d.locked;
  }

  /** Hapus objek terpilih (dipakai tombol panel objek & toolbar & keyboard). */
  private deleteSelectedDrawing(): void {
    if (!this.drawingStore.selectedId) return;
    this.drawingStore.removeDrawing(this.drawingStore.selectedId);
    this.drawingStore.saveToStorage(this.symbol);
    this.updateDrawingSelectionUI();
    this.markDirty();
  }

  private cycleDrawingColor(): void {
    const curColor = this.drawingStore.defaultStyle.color.toUpperCase();
    const idx = this.DRAW_COLORS.findIndex(c => c.toUpperCase() === curColor);
    const nextIdx = (idx + 1) % this.DRAW_COLORS.length;
    const nextColor = this.DRAW_COLORS[nextIdx];

    this.drawingStore.defaultStyle.color = nextColor;
    if (this.dtColorDotEl) {
      this.dtColorDotEl.style.backgroundColor = nextColor;
    }

    // If an object is currently selected, also update its color
    if (this.drawingStore.selectedId) {
      const selected = this.drawingStore.getDrawing(this.drawingStore.selectedId);
      if (selected) {
        selected.style.color = nextColor;
        this.drawingStore.saveToStorage(this.symbol);
        this.markDirty();
      }
    }
  }

  private toolName(t: DrawingType): string {
    switch (t) {
      case 'trendline': return 'Trendline';
      case 'hline': return 'Horizontal Line';
      case 'vline': return 'Vertical Line';
      case 'fibonacci': return 'Fibonacci';
      case 'rectangle': return 'Rectangle';
      default: return t;
    }
  }

  private tfLabel(tf: number): string {
    if (tf === 1) return '1m';
    if (tf === 5) return '5m';
    if (tf === 15) return '15m';
    if (tf === 60) return '1H';
    if (tf === 240) return '4H';
    if (tf === 1440) return 'D';
    return `${tf}m`;
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

/** Pemetaan kunci gaya garis ↔ array dash untuk panel pengaturan objek. */
function dashArrayOf(key: string): number[] {
  if (key === 'dash') return [6, 4];
  if (key === 'dot') return [1.5, 3.5];
  return [];
}

function dashKeyOf(dash?: number[]): string {
  if (!dash || dash.length === 0) return 'solid';
  if (dash[0] <= 2) return 'dot';
  return 'dash';
}
