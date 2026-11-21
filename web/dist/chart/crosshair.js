import { fmtPrice, fmtDate, decimalsOf } from './util.js';
const XH_COLOR = '#9598A1';
const BG_TAG = '#363A45';
export class CrosshairRenderer {
    mx = -1; // screen x
    my = -1; // screen y
    visible = false;
    update(x, y) {
        this.mx = x;
        this.my = y;
        this.visible = true;
    }
    hide() { this.visible = false; }
    draw(ovCtx, yCtx, xCtx, vp, bars, tf, tickSize) {
        if (!this.visible)
            return;
        const w = vp.w, h = vp.h;
        const dec = decimalsOf(tickSize);
        // --- Overlay canvas: dashed lines ---
        ovCtx.save();
        ovCtx.strokeStyle = XH_COLOR;
        ovCtx.lineWidth = 1;
        ovCtx.setLineDash([4, 3]);
        ovCtx.globalAlpha = 0.6;
        // horizontal
        ovCtx.beginPath();
        ovCtx.moveTo(0, this.my + 0.5);
        ovCtx.lineTo(w, this.my + 0.5);
        ovCtx.stroke();
        // vertical
        ovCtx.beginPath();
        ovCtx.moveTo(this.mx + 0.5, 0);
        ovCtx.lineTo(this.mx + 0.5, h);
        ovCtx.stroke();
        ovCtx.restore();
        // --- Y-axis price tag ---
        if (this.my >= 0 && this.my <= vp.chartH) {
            const price = vp.screenToY(this.my);
            const label = fmtPrice(price, dec);
            const yw = yCtx.canvas.width;
            yCtx.fillStyle = BG_TAG;
            yCtx.fillRect(0, this.my - 10, yw, 20);
            yCtx.fillStyle = '#D1D4DC';
            yCtx.font = '11px ui-monospace,SFMono-Regular,monospace';
            yCtx.textAlign = 'center';
            yCtx.textBaseline = 'middle';
            yCtx.fillText(label, yw / 2, this.my);
        }
        // --- X-axis time tag ---
        const barIdx = Math.round(vp.screenToX(this.mx));
        if (barIdx >= 0 && barIdx < bars.len) {
            const ts = bars.t[barIdx];
            const label = fmtDate(ts);
            const xw = xCtx.canvas.width;
            const xh = xCtx.canvas.height;
            const tx = vp.xToScreen(barIdx);
            xCtx.fillStyle = BG_TAG;
            const tw = xCtx.measureText(label).width + 12;
            xCtx.fillRect(tx - tw / 2, 0, tw, xh);
            xCtx.fillStyle = '#D1D4DC';
            xCtx.font = '10px ui-monospace,SFMono-Regular,monospace';
            xCtx.textAlign = 'center';
            xCtx.textBaseline = 'top';
            xCtx.fillText(label, tx, 4);
        }
    }
    /** Draw OHLCV info at top-left of the chart */
    drawInfo(el, bars, vp, tickSize) {
        const idx = Math.round(vp.screenToX(this.mx));
        if (idx < 0 || idx >= bars.len || !this.visible) {
            el.innerHTML = '';
            return;
        }
        const dec = decimalsOf(tickSize);
        const o = bars.o[idx], h = bars.h[idx], l = bars.l[idx], c = bars.c[idx], v = bars.v[idx];
        const bull = c >= o;
        const cls = bull ? 'up' : 'dn';
        el.innerHTML = `<b>O</b> <span class="${cls}">${fmtPrice(o, dec)}</span> `
            + `<b>H</b> <span class="${cls}">${fmtPrice(h, dec)}</span> `
            + `<b>L</b> <span class="${cls}">${fmtPrice(l, dec)}</span> `
            + `<b>C</b> <span class="${cls}">${fmtPrice(c, dec)}</span> `
            + `<b>V</b> <span class="iv">${formatVol(v)}</span>`;
    }
}
function formatVol(v) {
    if (v >= 1e9)
        return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6)
        return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3)
        return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(1);
}
