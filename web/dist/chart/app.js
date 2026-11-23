// ChartApp — orchestrator: init canvases, renderers, data, interaction
import { BarBuffer } from './data.js';
import { Viewport } from './viewport.js';
import { initGL } from './gl.js';
import { CandleRenderer } from './candles.js';
import { VolumeRenderer } from './volume.js';
import { GridRenderer } from './grid.js';
import { AxisRenderer } from './axis.js';
import { CrosshairRenderer } from './crosshair.js';
import { TpoRenderer } from './tpo.js';
import { DrawingStore, DrawingRenderer, createDrawing, screenXToTime, timeToScreenX, } from './drawing.js';
import { PanZoom } from './panzoom.js';
import { ChartClient } from './client.js';
import { fmtPrice, fmtDate, fmtChg, fmtPct, decimalsOf, formatVol } from './util.js';
export class ChartApp {
    glCanvas;
    ovCanvas;
    yCanvas;
    xCanvas;
    ovCtx;
    yCtx;
    xCtx;
    infoEl;
    statusEl;
    dotEl;
    pxEl;
    chgEl;
    btnFollowEl;
    btnTpoEl;
    btnNPocEl;
    btnExportEl;
    btnShortcutsEl;
    shortcutsModalEl;
    srcSelEl = null;
    btnCloseShortcutsEl;
    chartMainEl;
    btnClearDrawingsEl;
    btnDeleteSelectedEl = null;
    btnDrawColorEl = null;
    dtColorDotEl = null;
    // Bottom Status Bar elements (Informasi Tanggal & Waktu di Bawah)
    sbTimeEl = null;
    sbOEl = null;
    sbHEl = null;
    sbLEl = null;
    sbCEl = null;
    sbChgEl = null;
    sbVolEl = null;
    sbTfEl = null;
    glCtx = null;
    hasWebGL = true;
    DRAW_COLORS = ['#2962FF', '#EF5350', '#FFD700', '#00BCD4', '#26A69A', '#AB47BC', '#FFFFFF'];
    vp = new Viewport();
    bars = new BarBuffer();
    candles = new CandleRenderer();
    volume = new VolumeRenderer();
    grid = new GridRenderer();
    axis = new AxisRenderer();
    crosshair = new CrosshairRenderer();
    tpo = new TpoRenderer();
    drawingStore = new DrawingStore();
    drawingRenderer = new DrawingRenderer();
    panzoom;
    client;
    symbol = 'XAUUSDT';
    hoverHit = null;
    draggingDrawing = null;
    isInteractingWithDrawing() {
        return this.drawingStore.activeTool !== null ||
            this.draggingDrawing !== null ||
            this.hoverHit !== null;
    }
    // Track initial press when drawing shapes to support both click-drag and click-click
    toolPressStart = null;
    tf = 60; // current timeframe in minutes
    source = 'main'; // sumber data aktif (main = sesuai config server)
    srcInfo = null;
    refetchSeq = 0; // pembatal refetch yang sedang berjalan bila ada permintaan lebih baru
    tickSize = 0.01;
    openPrice = 0;
    dirty = true;
    rafId = 0;
    async init() {
        // DOM elements
        this.glCanvas = document.getElementById('glCanvas');
        this.ovCanvas = document.getElementById('ovCanvas');
        this.yCanvas = document.getElementById('yCanvas');
        this.xCanvas = document.getElementById('xCanvas');
        this.ovCtx = this.ovCanvas.getContext('2d');
        this.yCtx = this.yCanvas.getContext('2d');
        this.xCtx = this.xCanvas.getContext('2d');
        this.infoEl = document.getElementById('info');
        this.statusEl = document.getElementById('status');
        this.dotEl = document.getElementById('dot');
        this.pxEl = document.getElementById('px');
        this.chgEl = document.getElementById('chg');
        this.btnFollowEl = document.getElementById('btnFollow');
        this.btnTpoEl = document.getElementById('btnTpo');
        this.btnNPocEl = document.getElementById('btnNPoc');
        this.btnExportEl = document.getElementById('btnExport');
        this.btnShortcutsEl = document.getElementById('btnShortcuts');
        this.shortcutsModalEl = document.getElementById('shortcutsModal');
        this.btnCloseShortcutsEl = document.getElementById('btnCloseShortcuts');
        this.srcSelEl = document.getElementById('srcSel');
        this.chartMainEl = document.getElementById('chartMain');
        this.btnClearDrawingsEl = document.getElementById('btnClearDrawings');
        this.btnDeleteSelectedEl = document.getElementById('btnDeleteSelected');
        this.btnDrawColorEl = document.getElementById('btnDrawColor');
        this.dtColorDotEl = document.getElementById('dtColorDot');
        // Bottom Status Bar (Informasi Tanggal & Waktu di Bawah)
        this.sbTimeEl = document.getElementById('sbTime');
        this.sbOEl = document.getElementById('sbO');
        this.sbHEl = document.getElementById('sbH');
        this.sbLEl = document.getElementById('sbL');
        this.sbCEl = document.getElementById('sbC');
        this.sbChgEl = document.getElementById('sbChg');
        this.sbVolEl = document.getElementById('sbVol');
        this.sbTfEl = document.getElementById('sbTf');
        if (this.sbTfEl)
            this.sbTfEl.textContent = this.tfLabel(this.tf);
        // Drawing storage & interaction
        this.drawingStore.loadFromStorage(this.symbol);
        this.bindDrawingUI();
        this.bindDrawingMouse();
        this.bindDrawingTouch();
        // WebGL context first (with Canvas 2D fallback support)
        try {
            this.glCtx = initGL(this.glCanvas);
            this.hasWebGL = true;
        }
        catch (err) {
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
                this.switchSource(this.srcSelEl.value);
            });
        }
        // Client
        this.client = new ChartClient((bars) => { this.bars.load(bars); this.fitAndRender(); }, (price) => {
            if (this.source !== 'main')
                return; // harga tick WS hanya berlaku utk sumber utama
            this.bars.updateLast(price);
            this.updatePrice(price);
            this.markDirty();
        }, (connected) => { this.dotEl.className = connected ? 'ok' : ''; }, (tpoData) => { this.tpo.setData(tpoData); this.markDirty(); }, (src, tf, full, frameBars) => {
            // Frame live dari feed sumber alternatif
            if (src !== this.source || tf !== this.tf)
                return;
            if (full) {
                const wasEmpty = this.bars.len === 0;
                this.bars.load(frameBars);
                if (this.openPrice === 0 && frameBars.length > 0)
                    this.openPrice = frameBars[0].o;
                if (wasEmpty)
                    this.fitAndRender();
            }
            else {
                for (const b of frameBars)
                    this.bars.upsert(b);
                const lp = this.bars.lastPrice();
                if (lp > 0)
                    this.updatePrice(lp);
            }
            this.markDirty();
        });
        // PanZoom with X and Y axis drag & zoom support and double-click auto-fit
        this.panzoom = new PanZoom(document.getElementById('chartMain'), document.getElementById('yAxis'), document.getElementById('xAxis'), this.vp, () => this.markDirty(), (x, y) => { this.crosshair.update(x, y); this.markDirty(); }, () => { this.crosshair.hide(); this.markDirty(); }, (follow) => this.updateAutoFollowBtn(follow), () => this.isInteractingWithDrawing(), () => this.resetToLive());
        // Live bar timer tick every second for Y-axis countdown
        setInterval(() => {
            if (this.bars.len > 0)
                this.markDirty();
        }, 1000);
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
        // TF buttons
        document.getElementById('tf').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn)
                return;
            const tf = parseInt(btn.dataset['tf'] || '60');
            this.switchTf(tf);
        });
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
            if (this.source !== 'main')
                this.client.fetchBars(this.tf, 10).catch(() => { });
        }, 4 * 60 * 1000);
        // Fetch initial data with auto-retry
        const loadData = async () => {
            this.client.fetchTpo().then(tpo => this.tpo.setData(tpo)).catch(() => { });
            await this.refetchBars();
        };
        await loadData();
    }
    // ------------------------------------------------------------ sumber data alternatif
    /** Muat daftar sumber dari server; kembalikan pilihan tersimpan bila masih tersedia. */
    async loadSourceOptions() {
        const sel = this.srcSelEl;
        if (!sel)
            return;
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
            let saved = null;
            try {
                saved = localStorage.getItem('mcdash.chart.src');
            }
            catch { /* ignore */ }
            if (saved && saved !== 'main' && info.options.some(o => o.id === saved)) {
                sel.value = saved;
                this.switchSource(saved);
            }
        }
        catch { /* server belum siap; dropdown tetap default */ }
    }
    srcLabel(src) {
        const opt = this.srcInfo?.options.find(o => o.id === src);
        return opt?.label ?? (src === 'binance' ? 'Binance' : src === 'tv' ? 'TradingView' : 'Sumber utama');
    }
    updateSourceUI() {
        const ext = this.source !== 'main';
        // TPO/nPOC dihitung dari sumber utama — tidak berlaku untuk sumber alternatif
        if (this.btnTpoEl)
            this.btnTpoEl.disabled = ext;
        if (this.btnNPocEl)
            this.btnNPocEl.disabled = ext;
    }
    async switchSource(src) {
        if (src === this.source)
            return;
        this.source = src;
        this.client.setSource(src);
        if (this.srcSelEl)
            this.srcSelEl.value = src;
        try {
            localStorage.setItem('mcdash.chart.src', src);
        }
        catch { /* ignore */ }
        this.updateSourceUI();
        await this.refetchBars();
    }
    /** Muat ulang bar utk (source, tf) aktif dengan retry — feed alternatif butuh waktu spawn. */
    async refetchBars() {
        const seq = ++this.refetchSeq;
        const lbl = this.source === 'main' ? '' : this.srcLabel(this.source);
        this.statusEl.textContent = lbl ? `Memuat data ${lbl}…` : 'Memuat data…';
        for (let retry = 0; retry <= 30; retry++) {
            try {
                const bars = await this.client.fetchBars(this.tf);
                if (seq !== this.refetchSeq)
                    return;
                if (bars.length > 0) {
                    this.bars.load(bars);
                    this.openPrice = bars[0].o;
                    this.tickSize = this.detectTickSize(bars);
                    this.fitAndRender();
                    this.statusEl.textContent = '';
                    return;
                }
                if (retry === 30) {
                    this.statusEl.textContent = 'Data belum siap, silakan ganti timeframe / sumber atau refresh.';
                    return;
                }
            }
            catch (e) {
                if (seq !== this.refetchSeq)
                    return;
                if (retry >= 15) {
                    this.statusEl.textContent = `Gagal memuat: ${e}`;
                    return;
                }
            }
            await new Promise(r => setTimeout(r, 1000));
            if (seq !== this.refetchSeq)
                return;
        }
    }
    bindKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName))
                return;
            switch (e.key) {
                case '1':
                    this.switchTf(1);
                    break;
                case '2':
                    this.switchTf(5);
                    break;
                case '3':
                    this.switchTf(15);
                    break;
                case '4':
                    this.switchTf(60);
                    break;
                case '5':
                    this.switchTf(240);
                    break;
                case '6':
                    this.switchTf(1440);
                    break;
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
                    this.markDirty();
                    break;
                case 'ArrowRight':
                    this.vp.pan(-50, 0);
                    this.panzoom.setAutoFollow(false);
                    this.markDirty();
                    break;
                case 'p':
                case 'P': {
                    if (this.source !== 'main')
                        break; // TPO hanya utk sumber utama
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
                    if (this.source !== 'main')
                        break; // nPOC hanya utk sumber utama
                    const on = this.tpo.toggleNPOC();
                    if (this.btnNPocEl) {
                        this.btnNPocEl.classList.toggle('on', on);
                    }
                    this.markDirty();
                    break;
                }
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
                    }
                    else if (this.drawingStore.activeTool || this.drawingStore.pendingPoints.length > 0) {
                        this.setTool(null);
                    }
                    else if (this.drawingStore.selectedId) {
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
    bindDrawingUI() {
        const toolbar = document.getElementById('drawToolbar');
        if (toolbar) {
            toolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('.dt-btn');
                if (!btn)
                    return;
                const tool = btn.dataset['tool'];
                if (tool === 'select') {
                    this.setTool(null);
                }
                else if (tool) {
                    this.setTool(tool);
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
    setTool(tool) {
        this.drawingStore.cancelPending();
        this.drawingStore.setActiveTool(tool);
        this.updateToolbarUI();
        if (this.chartMainEl) {
            this.chartMainEl.style.cursor = tool ? 'crosshair' : 'default';
        }
        this.markDirty();
    }
    updateToolbarUI() {
        const active = this.drawingStore.activeTool;
        const buttons = document.querySelectorAll('#drawToolbar .dt-btn[data-tool]');
        buttons.forEach(btn => {
            const tool = btn.dataset['tool'];
            if (!active && tool === 'select') {
                btn.classList.add('on');
            }
            else if (active && tool === active) {
                btn.classList.add('on');
            }
            else {
                btn.classList.remove('on');
            }
        });
    }
    bindDrawingMouse() {
        this.chartMainEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            const rect = this.chartMainEl.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const screenX = (e.clientX - rect.left) * dpr;
            const screenY = (e.clientY - rect.top) * dpr;
            if (screenY > this.vp.chartH)
                return;
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
        window.addEventListener('mousemove', (e) => {
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
                            if (!orig)
                                continue;
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
                    }
                    else if (this.draggingDrawing.hitType === 'point' && this.draggingDrawing.pointIndex !== undefined) {
                        const pIdx = this.draggingDrawing.pointIndex;
                        if (d.type === 'rectangle' && d.points.length >= 2) {
                            const p0 = this.draggingDrawing.startPointsScreen[0];
                            const p1 = this.draggingDrawing.startPointsScreen[1];
                            if (pIdx === 0) {
                                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                                d.points[0].price = this.vp.screenToY(p0.y + dy);
                            }
                            else if (pIdx === 1) {
                                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                                d.points[1].price = this.vp.screenToY(p1.y + dy);
                            }
                            else if (pIdx === 2) {
                                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                                d.points[1].price = this.vp.screenToY(p1.y + dy);
                            }
                            else if (pIdx === 3) {
                                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                                d.points[0].price = this.vp.screenToY(p0.y + dy);
                            }
                        }
                        else if (d.points[pIdx]) {
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
                }
                else {
                    this.chartMainEl.style.cursor = 'crosshair';
                }
            }
            else {
                this.hoverHit = null;
            }
        });
        window.addEventListener('mouseup', (e) => {
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
    bindDrawingTouch() {
        this.chartMainEl.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1)
                return;
            const touch = e.touches[0];
            const rect = this.chartMainEl.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const screenX = (touch.clientX - rect.left) * dpr;
            const screenY = (touch.clientY - rect.top) * dpr;
            if (screenY > this.vp.chartH)
                return;
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
        this.chartMainEl.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 1)
                return;
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
                            if (!orig)
                                continue;
                            const newX = orig.x + dx;
                            const newY = orig.y + dy;
                            d.points[i].time = screenXToTime(newX, this.vp, this.bars);
                            if (d.type !== 'vline') {
                                d.points[i].price = this.vp.screenToY(newY);
                            }
                        }
                        this.draggingDrawing.moved = true;
                        this.markDirty();
                    }
                    else if (this.draggingDrawing.hitType === 'point' && this.draggingDrawing.pointIndex !== undefined) {
                        const pIdx = this.draggingDrawing.pointIndex;
                        if (d.type === 'rectangle' && d.points.length >= 2) {
                            const p0 = this.draggingDrawing.startPointsScreen[0];
                            const p1 = this.draggingDrawing.startPointsScreen[1];
                            if (pIdx === 0) {
                                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                                d.points[0].price = this.vp.screenToY(p0.y + dy);
                            }
                            else if (pIdx === 1) {
                                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                                d.points[1].price = this.vp.screenToY(p1.y + dy);
                            }
                            else if (pIdx === 2) {
                                d.points[0].time = screenXToTime(p0.x + dx, this.vp, this.bars);
                                d.points[1].price = this.vp.screenToY(p1.y + dy);
                            }
                            else if (pIdx === 3) {
                                d.points[1].time = screenXToTime(p1.x + dx, this.vp, this.bars);
                                d.points[0].price = this.vp.screenToY(p0.y + dy);
                            }
                        }
                        else if (d.points[pIdx]) {
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
        this.chartMainEl.addEventListener('touchend', (e) => {
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
    handleToolMouseDown(_screenX, _screenY, time, price) {
        const tool = this.drawingStore.activeTool;
        if (!tool)
            return;
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
        }
        else if (this.drawingStore.pendingPoints.length === 1) {
            this.finalizeMultiPointDrawing(time, price);
        }
    }
    finalizeMultiPointDrawing(time, price) {
        const tool = this.drawingStore.activeTool;
        if (!tool || this.drawingStore.pendingPoints.length === 0)
            return;
        const p1 = this.drawingStore.pendingPoints[0];
        const p2 = { time, price };
        let style = { color: this.drawingStore.defaultStyle.color, width: 2 };
        if (tool === 'fibonacci') {
            style = { color: this.drawingStore.defaultStyle.color, width: 1 };
        }
        else if (tool === 'rectangle') {
            style = { color: this.drawingStore.defaultStyle.color, width: 1.5 };
        }
        else if (tool === 'trendline') {
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
    exportPNG() {
        const totalW = this.ovCanvas.width + this.yCanvas.width;
        const totalH = this.ovCanvas.height + this.xCanvas.height;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = totalW;
        exportCanvas.height = totalH;
        const ctx = exportCanvas.getContext('2d');
        if (!ctx)
            return;
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
        ctx.font = 'bold 12px ui-monospace,SFMono-Regular,monospace';
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
    resetToLive() {
        if (this.bars.len === 0)
            return;
        this.vp.autoFitY = true;
        this.vp.scrollToEnd(this.bars.len);
        const [lo, hi] = this.bars.priceRange(Math.max(0, this.vp.xMin), this.vp.xMax);
        if (lo < Infinity)
            this.vp.fitY(lo, hi);
        this.panzoom.setAutoFollow(true);
        this.updateAutoFollowBtn(true);
        this.markDirty();
    }
    updateAutoFollowBtn(follow) {
        if (this.btnFollowEl) {
            this.btnFollowEl.classList.toggle('hidden', follow);
        }
    }
    resize() {
        const main = document.getElementById('chartMain');
        const dpr = window.devicePixelRatio || 1;
        const w = main.clientWidth || 800;
        const h = main.clientHeight || 500;
        this.glCanvas.width = w * dpr;
        this.glCanvas.height = h * dpr;
        this.ovCanvas.width = w * dpr;
        this.ovCanvas.height = h * dpr;
        const yAxis = document.getElementById('yAxis');
        this.yCanvas.width = (yAxis.clientWidth || 76) * dpr;
        this.yCanvas.height = (yAxis.clientHeight || h) * dpr;
        const xAxis = document.getElementById('xAxis') || this.xCanvas.parentElement;
        this.xCanvas.width = (xAxis.clientWidth || w) * dpr;
        this.xCanvas.height = (xAxis.clientHeight || 30) * dpr;
        this.vp.setSize(w * dpr, h * dpr, dpr);
        if (this.glCtx && this.glCtx.gl) {
            this.glCtx.gl.viewport(0, 0, w * dpr, h * dpr);
        }
    }
    markDirty() { this.dirty = true; }
    fitAndRender() {
        if (this.bars.len === 0)
            return;
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
    async switchTf(tf) {
        // Update button states
        document.querySelectorAll('#tf button').forEach(b => {
            b.classList.toggle('on', parseInt(b.dataset['tf'] || '0') === tf);
        });
        this.tf = tf;
        this.client.setTf(tf);
        if (this.sbTfEl)
            this.sbTfEl.textContent = this.tfLabel(tf);
        await this.refetchBars();
    }
    updatePrice(price) {
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
                if (lo < Infinity)
                    this.vp.fitY(lo, hi);
            }
        }
    }
    renderLoop = () => {
        if (this.dirty) {
            this.dirty = false;
            this.render();
        }
        this.rafId = requestAnimationFrame(this.renderLoop);
    };
    render() {
        const { glCtx, vp, bars, candles, volume, grid, axis, crosshair } = this;
        const gl = glCtx?.gl;
        if (gl) {
            // Clear WebGL canvas
            gl.clearColor(0.075, 0.09, 0.133, 1.0); // #131722
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // Clear overlay canvas
        this.ovCtx.clearRect(0, 0, vp.w, vp.h);
        if (bars.len === 0)
            return;
        // Fit Y when scrolling/zooming X (only if autoFitY is active)
        if (vp.autoFitY) {
            const [lo, hi] = bars.priceRange(Math.max(0, vp.xMin), vp.xMax);
            if (lo < Infinity)
                vp.fitY(lo, hi);
        }
        // 1. Watermark ATAS / DeepChart background signature
        this.drawWatermark(vp);
        // 2. Candles & Volume (WebGL if supported, otherwise Canvas 2D fallback)
        if (this.hasWebGL && glCtx) {
            const view = vp.clipView();
            candles.rebuild(bars, vp);
            candles.draw(glCtx, view);
            volume.rebuild(bars, vp);
            volume.draw(glCtx, view);
        }
        else {
            this.drawCandles2D(vp, bars);
            this.drawVolume2D(vp, bars);
        }
        // 3. Grid lines
        grid.draw(this.ovCtx, vp, this.tf);
        // 4. Extrema High & Low Markers (ATAS style ▼ High / ▲ Low markers)
        this.drawExtremaMarkers(vp, bars);
        // 5. Draw TPO overlay (blocks, level lines, separators, nPOC) — hanya utk sumber utama
        if (this.source === 'main') {
            this.tpo.draw(this.ovCtx, vp, bars);
        }
        // 6. Draw user drawings
        this.drawingRenderer.draw(this.ovCtx, vp, bars, this.drawingStore);
        // 7. Draw axes (clears axis canvases)
        const lastBarTs = bars.len > 0 ? bars.t[bars.len - 1] : 0;
        axis.drawY(this.yCtx, vp, this.tickSize, bars.lastPrice(), this.openPrice, lastBarTs, this.tf);
        axis.drawX(this.xCtx, vp, bars, this.tf);
        // 8. Draw crosshair on overlay and price/time badges on axes (on top of axis labels)
        crosshair.draw(this.ovCtx, this.yCtx, this.xCtx, vp, bars, this.tf, this.tickSize);
        crosshair.drawInfo(this.infoEl, bars, vp, this.tickSize, this.tf);
        this.updateBottomBar(bars, vp);
        // 9. Current price horizontal line on overlay
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
    /** Background symbol & timeframe watermark (khas ATAS / DeepChart) */
    drawWatermark(vp) {
        const dpr = vp.dpr || 1;
        const ctx = this.ovCtx;
        const centerX = vp.w / 2;
        const centerY = vp.chartH / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = Math.min(Math.round(vp.w * 0.12), Math.round(64 * dpr));
        ctx.font = `900 ${fontSize}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.038)';
        ctx.fillText(`${this.symbol} • ${this.tfLabel(this.tf)}`, centerX, centerY - 12 * dpr);
        const subSize = Math.max(Math.round(10 * dpr), Math.round(fontSize * 0.22));
        ctx.font = `700 ${subSize}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.024)';
        ctx.fillText('MCDASH • ATAS ORDER FLOW PROFILE', centerX, centerY + fontSize * 0.42);
        ctx.restore();
    }
    /** Visible range High / Low extrema markers (panah ▼ H dan ▲ L khas ATAS) */
    drawExtremaMarkers(vp, bars) {
        if (bars.len === 0)
            return;
        const dpr = vp.dpr || 1;
        const ctx = this.ovCtx;
        const iStart = Math.max(0, Math.floor(vp.xMin));
        const iEnd = Math.min(bars.len - 1, Math.ceil(vp.xMax));
        if (iStart > iEnd)
            return;
        let maxH = -Infinity;
        let maxIdx = -1;
        let minL = Infinity;
        let minIdx = -1;
        for (let i = iStart; i <= iEnd; i++) {
            if (bars.h[i] > maxH) {
                maxH = bars.h[i];
                maxIdx = i;
            }
            if (bars.l[i] < minL) {
                minL = bars.l[i];
                minIdx = i;
            }
        }
        const dec = decimalsOf(this.tickSize);
        ctx.save();
        ctx.font = `bold ${Math.round(9.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.textAlign = 'center';
        // High marker (panah merah ▼ dan harga)
        if (maxIdx >= 0) {
            const x = vp.xToScreen(maxIdx);
            const y = vp.yToScreen(maxH);
            if (x >= 24 * dpr && x <= vp.w - 24 * dpr && y >= 14 * dpr && y <= vp.chartH) {
                ctx.fillStyle = '#EF5350';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`▼ H: ${fmtPrice(maxH, dec)}`, x, y - 4 * dpr);
            }
        }
        // Low marker (panah hijau ▲ dan harga)
        if (minIdx >= 0) {
            const x = vp.xToScreen(minIdx);
            const y = vp.yToScreen(minL);
            if (x >= 24 * dpr && x <= vp.w - 24 * dpr && y >= 0 && y <= vp.chartH - 14 * dpr) {
                ctx.fillStyle = '#26A69A';
                ctx.textBaseline = 'top';
                ctx.fillText(`▲ L: ${fmtPrice(minL, dec)}`, x, y + 4 * dpr);
            }
        }
        ctx.restore();
    }
    /** Canvas 2D fallback for candlesticks (used if WebGL2 is not available) */
    drawCandles2D(vp, bars) {
        const ctx = this.ovCtx;
        const dpr = vp.dpr || 1;
        const iStart = Math.max(0, Math.floor(vp.xMin) - 1);
        const iEnd = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);
        const candleWidth = Math.max(1, (vp.w / Math.max(1, vp.visibleBars)) * 0.75);
        const halfW = candleWidth / 2;
        ctx.save();
        for (let i = iStart; i <= iEnd; i++) {
            const o = bars.o[i], h = bars.h[i], l = bars.l[i], c = bars.c[i];
            const x = vp.xToScreen(i);
            const bull = c >= o;
            const color = bull ? '#26A69A' : '#EF5350';
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
    drawVolume2D(vp, bars) {
        const ctx = this.ovCtx;
        const iStart = Math.max(0, Math.floor(vp.xMin) - 1);
        const iEnd = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);
        let maxVol = 0;
        for (let i = iStart; i <= iEnd; i++) {
            if (bars.v[i] > maxVol)
                maxVol = bars.v[i];
        }
        if (maxVol <= 0)
            return;
        const volH = vp.chartH * vp.volFrac;
        const candleWidth = Math.max(1, (vp.w / Math.max(1, vp.visibleBars)) * 0.75);
        const halfW = candleWidth / 2;
        ctx.save();
        for (let i = iStart; i <= iEnd; i++) {
            const x = vp.xToScreen(i);
            const hBar = (bars.v[i] / maxVol) * volH * 0.95;
            const y = vp.h - hBar;
            const bull = bars.c[i] >= bars.o[i];
            ctx.fillStyle = bull ? 'rgba(38, 166, 154, 0.28)' : 'rgba(239, 83, 80, 0.28)';
            ctx.fillRect(x - halfW, y, candleWidth, hBar);
        }
        ctx.restore();
    }
    updateBottomBar(bars, vp) {
        if (!this.sbTimeEl || bars.len === 0)
            return;
        // Interactive guidance when drawing tool is active
        if (this.drawingStore.activeTool) {
            const toolTitle = this.toolName(this.drawingStore.activeTool);
            if (this.drawingStore.pendingPoints.length === 0) {
                this.sbTimeEl.textContent = `✏️ ${toolTitle}: Sentuh / Klik titik 1 • Esc batal`;
            }
            else {
                this.sbTimeEl.textContent = `✏️ Tarik ke titik 2 untuk menyelesaikan ${toolTitle}`;
            }
            return;
        }
        if (this.drawingStore.selectedId) {
            this.sbTimeEl.textContent = `📌 1 gambar dipilih • Del / icon tong sampah untuk hapus`;
        }
        else {
            let idx = this.crosshair.visible ? Math.round(vp.screenToX(this.crosshair.mx)) : bars.len - 1;
            if (idx < 0 || idx >= bars.len) {
                idx = bars.len - 1;
            }
            const ts = bars.t[idx];
            this.sbTimeEl.textContent = `${fmtDate(ts, this.tf)}`;
        }
        let idx = this.crosshair.visible ? Math.round(vp.screenToX(this.crosshair.mx)) : bars.len - 1;
        if (idx < 0 || idx >= bars.len) {
            idx = bars.len - 1;
        }
        const dec = decimalsOf(this.tickSize);
        const o = bars.o[idx], h = bars.h[idx], l = bars.l[idx], c = bars.c[idx], v = bars.v[idx];
        const diff = c - o;
        const pct = o !== 0 ? (diff / o) * 100 : 0;
        const bull = diff >= 0;
        const cls = bull ? 'up' : 'dn';
        if (this.sbOEl)
            this.sbOEl.textContent = fmtPrice(o, dec);
        if (this.sbHEl)
            this.sbHEl.textContent = fmtPrice(h, dec);
        if (this.sbLEl)
            this.sbLEl.textContent = fmtPrice(l, dec);
        if (this.sbCEl) {
            this.sbCEl.textContent = fmtPrice(c, dec);
            this.sbCEl.className = `val ${cls}`;
        }
        if (this.sbChgEl) {
            this.sbChgEl.textContent = `${fmtChg(diff, dec)} (${fmtPct(pct)})`;
            this.sbChgEl.className = `val ${cls}`;
        }
        if (this.sbVolEl)
            this.sbVolEl.textContent = formatVol(v);
    }
    updateDrawingSelectionUI() {
        const selected = this.drawingStore.selectedId ? this.drawingStore.getDrawing(this.drawingStore.selectedId) : null;
        if (this.btnDeleteSelectedEl) {
            this.btnDeleteSelectedEl.disabled = !selected;
            this.btnDeleteSelectedEl.style.opacity = selected ? '1' : '0.3';
        }
        if (selected && this.dtColorDotEl) {
            this.dtColorDotEl.style.backgroundColor = selected.style.color;
        }
        else if (this.dtColorDotEl) {
            this.dtColorDotEl.style.backgroundColor = this.drawingStore.defaultStyle.color;
        }
    }
    cycleDrawingColor() {
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
    toolName(t) {
        switch (t) {
            case 'trendline': return 'Trendline';
            case 'hline': return 'Horizontal Line';
            case 'vline': return 'Vertical Line';
            case 'fibonacci': return 'Fibonacci';
            case 'rectangle': return 'Rectangle';
            default: return t;
        }
    }
    tfLabel(tf) {
        if (tf === 1)
            return '1m';
        if (tf === 5)
            return '5m';
        if (tf === 15)
            return '15m';
        if (tf === 60)
            return '1H';
        if (tf === 240)
            return '4H';
        if (tf === 1440)
            return 'D';
        return `${tf}m`;
    }
    detectTickSize(bars) {
        // detect from price precision
        let maxDec = 0;
        for (let i = 0; i < Math.min(bars.length, 20); i++) {
            const b = bars[i];
            for (const p of [b.o, b.h, b.l, b.c]) {
                const s = p.toString();
                const d = s.indexOf('.');
                if (d >= 0)
                    maxDec = Math.max(maxDec, s.length - d - 1);
            }
        }
        return Math.pow(10, -maxDec);
    }
}
