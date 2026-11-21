import { fmtPrice, fmtDate, fmtChg, fmtPct, decimalsOf, formatVol } from './util.js';
import { screenXToTime } from './drawing.js';
const XH_COLOR = '#9598A1';
const BG_TAG = '#1E222D';
const BORDER_TAG = '#2962FF';
export class CrosshairRenderer {
    mx = -1; // screen x (in device pixels)
    my = -1; // screen y (in device pixels)
    visible = false;
    update(x, y) {
        this.mx = x;
        this.my = y;
        this.visible = true;
    }
    hide() {
        this.visible = false;
    }
    draw(ovCtx, yCtx, xCtx, vp, bars, tf, tickSize) {
        if (!this.visible || this.mx < 0 || this.my < 0)
            return;
        const w = vp.w, h = vp.h;
        const dpr = vp.dpr || 1;
        const dec = decimalsOf(tickSize);
        // Smooth 1:1 crosshair following mouse cursor exactly (ATAS / DeepChart style)
        const cx = Math.round(this.mx) + 0.5;
        const cy = Math.round(this.my) + 0.5;
        // --- Overlay canvas: crisp dashed lines ---
        ovCtx.save();
        ovCtx.strokeStyle = XH_COLOR;
        ovCtx.lineWidth = 1 * dpr;
        ovCtx.setLineDash([4 * dpr, 3 * dpr]);
        ovCtx.globalAlpha = 0.75;
        // Horizontal line across chart
        ovCtx.beginPath();
        ovCtx.moveTo(0, cy);
        ovCtx.lineTo(w, cy);
        ovCtx.stroke();
        // Vertical line across chart
        ovCtx.beginPath();
        ovCtx.moveTo(cx, 0);
        ovCtx.lineTo(cx, h);
        ovCtx.stroke();
        ovCtx.restore();
        // Intersection dot
        ovCtx.save();
        ovCtx.fillStyle = '#FFFFFF';
        ovCtx.beginPath();
        ovCtx.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2);
        ovCtx.fill();
        ovCtx.restore();
        // --- Y-axis price badge ---
        if (this.my >= 0 && this.my <= vp.chartH) {
            const price = vp.screenToY(this.my);
            const label = fmtPrice(price, dec);
            const yw = yCtx.canvas.width;
            const h2 = 10 * dpr;
            yCtx.save();
            yCtx.fillStyle = BG_TAG;
            yCtx.strokeStyle = BORDER_TAG;
            yCtx.lineWidth = 1.5 * dpr;
            yCtx.beginPath();
            yCtx.moveTo(0, this.my);
            yCtx.lineTo(6 * dpr, this.my - h2);
            yCtx.lineTo(yw, this.my - h2);
            yCtx.lineTo(yw, this.my + h2);
            yCtx.lineTo(6 * dpr, this.my + h2);
            yCtx.closePath();
            yCtx.fill();
            yCtx.stroke();
            yCtx.fillStyle = '#FFFFFF';
            yCtx.font = `bold ${Math.round(11 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
            yCtx.textAlign = 'center';
            yCtx.textBaseline = 'middle';
            yCtx.fillText(label, (yw + 5 * dpr) / 2, this.my);
            yCtx.restore();
        }
        // --- X-axis date & time badge ---
        const ts = screenXToTime(this.mx, vp, bars);
        const label = fmtDate(ts, tf);
        const xh = xCtx.canvas.height;
        const xw = xCtx.canvas.width;
        xCtx.save();
        xCtx.font = `bold ${Math.round(10.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        const tw = xCtx.measureText(label).width + 16 * dpr;
        const clampCx = Math.max(tw / 2, Math.min(xw - tw / 2, cx));
        xCtx.fillStyle = BG_TAG;
        xCtx.fillRect(clampCx - tw / 2, 0, tw, xh);
        xCtx.strokeStyle = BORDER_TAG;
        xCtx.lineWidth = 1.5 * dpr;
        xCtx.strokeRect(clampCx - tw / 2 + 0.5, 0.5, tw - 1, xh - 1);
        xCtx.fillStyle = '#FFFFFF';
        xCtx.textAlign = 'center';
        xCtx.textBaseline = 'middle';
        xCtx.fillText(label, clampCx, xh / 2);
        xCtx.restore();
    }
    /** Draw OHLCV info at top-left of the chart (shows hovered bar, or latest bar if crosshair inactive) */
    drawInfo(el, bars, vp, tickSize, tf) {
        if (bars.len === 0) {
            el.innerHTML = '';
            return;
        }
        let idx = this.visible ? Math.round(vp.screenToX(this.mx)) : bars.len - 1;
        if (idx < 0 || idx >= bars.len) {
            idx = bars.len - 1;
        }
        const dec = decimalsOf(tickSize);
        const o = bars.o[idx], h = bars.h[idx], l = bars.l[idx], c = bars.c[idx], v = bars.v[idx];
        const diff = c - o;
        const pct = o !== 0 ? (diff / o) * 100 : 0;
        const bull = diff >= 0;
        const cls = bull ? 'up' : 'dn';
        const ts = bars.t[idx];
        const timeStr = fmtDate(ts, tf);
        el.innerHTML = `<span class="iv" style="color:#B2B5BE;font-weight:600">[${timeStr}]</span> `
            + `<b>O</b> <span class="${cls}">${fmtPrice(o, dec)}</span> `
            + `<b>H</b> <span class="${cls}">${fmtPrice(h, dec)}</span> `
            + `<b>L</b> <span class="${cls}">${fmtPrice(l, dec)}</span> `
            + `<b>C</b> <span class="${cls}">${fmtPrice(c, dec)}</span> `
            + `<b>Chg</b> <span class="${cls}">${fmtChg(diff, dec)} (${fmtPct(pct)})</span> `
            + `<b>Vol</b> <span class="iv">${formatVol(v)}</span>`;
    }
}
