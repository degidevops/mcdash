import { fmtPrice, fmtDate, fmtChg, fmtPct, decimalsOf } from './util.js';
const XH_COLOR = '#9598A1';
const BG_TAG = '#363A45';
const BORDER_TAG = '#4c525e';
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
        // Calculate snap X to candle center if within bounds
        const barIdx = Math.round(vp.screenToX(this.mx));
        const hasBar = barIdx >= 0 && barIdx < bars.len;
        const snapX = hasBar ? Math.round(vp.xToScreen(barIdx)) + 0.5 : this.mx + 0.5;
        // --- Overlay canvas: dashed lines ---
        ovCtx.save();
        ovCtx.strokeStyle = XH_COLOR;
        ovCtx.lineWidth = 1;
        ovCtx.setLineDash([4, 3]);
        ovCtx.globalAlpha = 0.65;
        // horizontal line
        ovCtx.beginPath();
        ovCtx.moveTo(0, this.my + 0.5);
        ovCtx.lineTo(w, this.my + 0.5);
        ovCtx.stroke();
        // vertical line (snapped to candle)
        ovCtx.beginPath();
        ovCtx.moveTo(snapX, 0);
        ovCtx.lineTo(snapX, h);
        ovCtx.stroke();
        ovCtx.restore();
        // Intersection dot
        ovCtx.save();
        ovCtx.fillStyle = '#FFFFFF';
        ovCtx.beginPath();
        ovCtx.arc(snapX, this.my + 0.5, 2.5, 0, Math.PI * 2);
        ovCtx.fill();
        // If hovering on a valid candle, also highlight the candle close point
        if (hasBar) {
            const closeY = Math.round(vp.yToScreen(bars.c[barIdx])) + 0.5;
            const bull = bars.c[barIdx] >= bars.o[barIdx];
            ovCtx.fillStyle = bull ? '#26A69A' : '#EF5350';
            ovCtx.beginPath();
            ovCtx.arc(snapX, closeY, 2.5, 0, Math.PI * 2);
            ovCtx.fill();
        }
        ovCtx.restore();
        // --- Y-axis price tag ---
        if (this.my >= 0 && this.my <= vp.chartH) {
            const price = vp.screenToY(this.my);
            const label = fmtPrice(price, dec);
            const yw = yCtx.canvas.width;
            yCtx.save();
            yCtx.fillStyle = BG_TAG;
            yCtx.fillRect(0, this.my - 10, yw, 20);
            yCtx.strokeStyle = BORDER_TAG;
            yCtx.lineWidth = 1;
            yCtx.strokeRect(0.5, this.my - 9.5, yw - 1, 19);
            yCtx.fillStyle = '#FFFFFF';
            yCtx.font = 'bold 11px ui-monospace,SFMono-Regular,monospace';
            yCtx.textAlign = 'center';
            yCtx.textBaseline = 'middle';
            yCtx.fillText(label, yw / 2, this.my);
            yCtx.restore();
        }
        // --- X-axis time tag ---
        let ts;
        if (bars.len > 0) {
            if (barIdx >= 0 && barIdx < bars.len) {
                ts = bars.t[barIdx];
            }
            else if (barIdx >= bars.len) {
                ts = bars.t[bars.len - 1] + (barIdx - (bars.len - 1)) * tf * 60;
            }
            else {
                ts = bars.t[0] + barIdx * tf * 60;
            }
        }
        else {
            ts = Math.floor(Date.now() / 1000);
        }
        const label = fmtDate(ts, tf);
        const xh = xCtx.canvas.height;
        const xw = xCtx.canvas.width;
        xCtx.save();
        xCtx.font = '10px ui-monospace,SFMono-Regular,monospace';
        const tw = xCtx.measureText(label).width + 14;
        const clampSnapX = Math.max(tw / 2, Math.min(xw - tw / 2, snapX));
        xCtx.fillStyle = BG_TAG;
        xCtx.fillRect(clampSnapX - tw / 2, 0, tw, xh);
        xCtx.strokeStyle = BORDER_TAG;
        xCtx.lineWidth = 1;
        xCtx.strokeRect(clampSnapX - tw / 2 + 0.5, 0.5, tw - 1, xh - 1);
        xCtx.fillStyle = '#FFFFFF';
        xCtx.textAlign = 'center';
        xCtx.textBaseline = 'middle';
        xCtx.fillText(label, clampSnapX, xh / 2);
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
        el.innerHTML = `<span class="iv">${timeStr}</span> `
            + `<b>O</b> <span class="${cls}">${fmtPrice(o, dec)}</span> `
            + `<b>H</b> <span class="${cls}">${fmtPrice(h, dec)}</span> `
            + `<b>L</b> <span class="${cls}">${fmtPrice(l, dec)}</span> `
            + `<b>C</b> <span class="${cls}">${fmtPrice(c, dec)}</span> `
            + `<b>Chg</b> <span class="${cls}">${fmtChg(diff, dec)} (${fmtPct(pct)})</span> `
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
