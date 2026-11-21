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
import { DrawingStore, DrawingRenderer, createDrawing, screenXToTime, } from './drawing.js';
import { PanZoom } from './panzoom.js';
import { ChartClient } from './client.js';
import { fmtPrice, fmtPct, decimalsOf } from './util.js';
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
    chartMainEl;
    btnClearDrawingsEl;
    glCtx;
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
    draggingDrawing = null;
    tf = 60; // current timeframe in minutes
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
        this.chartMainEl = document.getElementById('chartMain');
        this.btnClearDrawingsEl = document.getElementById('btnClearDrawings');
        // Drawing storage & interaction
        this.drawingStore.loadFromStorage(this.symbol);
        this.bindDrawingUI();
        this.bindDrawingMouse();
        // WebGL context first
        this.glCtx = initGL(this.glCanvas);
        // Size canvases (after glCtx is ready)
        this.resize();
        window.addEventListener('resize', () => { this.resize(); this.markDirty(); });
        // Client
        this.client = new ChartClient((bars) => { this.bars.load(bars); this.fitAndRender(); }, (price) => { this.bars.updateLast(price); this.updatePrice(price); this.markDirty(); }, (connected) => { this.dotEl.className = connected ? 'ok' : ''; }, (tpoData) => { this.tpo.setData(tpoData); this.markDirty(); });
        // PanZoom with Y-axis drag support
        this.panzoom = new PanZoom(document.getElementById('chartMain'), document.getElementById('yAxis'), this.vp, () => this.markDirty(), (x, y) => { this.crosshair.update(x, y); this.markDirty(); }, () => { this.crosshair.hide(); this.markDirty(); }, (follow) => this.updateAutoFollowBtn(follow));
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
                }
                else if (retry < 30) {
                    setTimeout(() => loadData(retry + 1), 1000);
                }
                else {
                    this.statusEl.textContent = 'Data belum siap, silakan ganti timeframe atau refresh.';
                }
            }
            catch (e) {
                this.statusEl.textContent = `Gagal memuat: ${e}`;
                if (retry < 15)
                    setTimeout(() => loadData(retry + 1), 1500);
            }
        };
        await loadData();
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
                case 't':
                case 'T':
                    this.setTool('trendline');
                    break;
                case 'h':
                case 'H':
                    this.setTool('hline');
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
                    if (this.drawingStore.activeTool || this.drawingStore.pendingPoints.length > 0) {
                        this.setTool(null);
                    }
                    else if (this.drawingStore.selectedId) {
                        this.drawingStore.setSelected(null);
                        this.markDirty();
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    if (this.drawingStore.selectedId) {
                        this.drawingStore.removeDrawing(this.drawingStore.selectedId);
                        this.drawingStore.saveToStorage(this.symbol);
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
        if (this.btnClearDrawingsEl) {
            this.btnClearDrawingsEl.addEventListener('click', () => {
                this.drawingStore.clearAll();
                this.drawingStore.saveToStorage(this.symbol);
                this.setTool(null);
                this.markDirty();
            });
        }
    }
    setTool(tool) {
        this.drawingStore.cancelPending();
        this.drawingStore.setActiveTool(tool);
        this.updateToolbarUI();
        if (this.chartMainEl) {
            this.chartMainEl.style.cursor = 'crosshair';
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
                this.handleToolMouseDown(screenX, screenY, time, price);
                return;
            }
            const hit = this.drawingStore.hitTest(screenX, screenY, this.vp, this.bars);
            if (hit) {
                e.stopPropagation();
                this.drawingStore.setSelected(hit.drawing.id);
                this.draggingDrawing = {
                    drawingId: hit.drawing.id,
                    hitType: hit.hitType,
                    pointIndex: hit.pointIndex,
                    startPoint: { time, price },
                    startPoints: hit.drawing.points.map(p => ({ ...p })),
                    startScreenX: screenX,
                    startScreenY: screenY,
                    moved: false,
                };
                this.markDirty();
                return;
            }
            if (this.drawingStore.selectedId) {
                this.drawingStore.setSelected(null);
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
                    if (this.draggingDrawing.hitType === 'point' && this.draggingDrawing.pointIndex !== undefined) {
                        if (d.points[this.draggingDrawing.pointIndex]) {
                            d.points[this.draggingDrawing.pointIndex] = { time, price };
                            this.draggingDrawing.moved = true;
                            this.markDirty();
                        }
                    }
                    else if (this.draggingDrawing.hitType === 'body') {
                        const dt = time - this.draggingDrawing.startPoint.time;
                        const dp = price - this.draggingDrawing.startPoint.price;
                        for (let i = 0; i < d.points.length; i++) {
                            d.points[i] = {
                                time: this.draggingDrawing.startPoints[i].time + dt,
                                price: this.draggingDrawing.startPoints[i].price + dp,
                            };
                        }
                        this.draggingDrawing.moved = true;
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
                if (hit) {
                    this.chartMainEl.style.cursor = hit.hitType === 'point' ? 'pointer' : 'move';
                }
                else {
                    this.chartMainEl.style.cursor = 'crosshair';
                }
            }
        });
        window.addEventListener('mouseup', () => {
            if (this.draggingDrawing) {
                if (this.draggingDrawing.moved) {
                    this.drawingStore.saveToStorage(this.symbol);
                }
                this.draggingDrawing = null;
            }
        });
    }
    handleToolMouseDown(_screenX, _screenY, time, price) {
        const tool = this.drawingStore.activeTool;
        if (!tool)
            return;
        if (tool === 'hline') {
            const drawing = createDrawing('hline', [{ time, price }], {
                color: '#787B86',
                width: 1.5,
                dash: [4, 4],
            });
            this.drawingStore.addDrawing(drawing);
            this.drawingStore.setSelected(drawing.id);
            this.drawingStore.cancelPending();
            this.setTool(null);
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
            const p1 = this.drawingStore.pendingPoints[0];
            const p2 = { time, price };
            let style = { color: '#2962FF', width: 2 };
            if (tool === 'fibonacci') {
                style = { color: '#9C27B0', width: 1 };
            }
            else if (tool === 'rectangle') {
                style = { color: '#2962FF', width: 1.5 };
            }
            else if (tool === 'trendline') {
                style = { color: '#2962FF', width: 2 };
            }
            const drawing = createDrawing(tool, [p1, p2], style);
            this.drawingStore.addDrawing(drawing);
            this.drawingStore.setSelected(drawing.id);
            this.drawingStore.cancelPending();
            this.setTool(null);
            this.drawingStore.saveToStorage(this.symbol);
            this.markDirty();
        }
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
        this.yCanvas.width = (yAxis.clientWidth || 72) * dpr;
        this.yCanvas.height = (yAxis.clientHeight || h) * dpr;
        const xRow = this.xCanvas.parentElement;
        this.xCanvas.width = (xRow.clientWidth || w) * dpr;
        this.xCanvas.height = (xRow.clientHeight || 22) * dpr;
        this.vp.setSize(w * dpr, h * dpr);
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
        }
        catch (e) {
            this.statusEl.textContent = `Gagal memuat: ${e}`;
        }
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
        const gl = glCtx.gl;
        // Clear WebGL canvas
        gl.clearColor(0.075, 0.09, 0.133, 1.0); // #131722
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (bars.len === 0)
            return;
        // Fit Y when scrolling/zooming X (only if autoFitY is active)
        if (vp.autoFitY) {
            const [lo, hi] = bars.priceRange(Math.max(0, vp.xMin), vp.xMax);
            if (lo < Infinity)
                vp.fitY(lo, hi);
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
        // Draw user drawings
        this.drawingRenderer.draw(this.ovCtx, vp, bars, this.drawingStore);
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
