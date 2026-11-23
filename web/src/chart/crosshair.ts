// CrosshairRenderer — dashed lines, precision Y/X axis badges + ATAS / DeepChart HUD
import type { Viewport } from './viewport.js';
import type { BarBuffer } from './data.js';
import { fmtPrice, fmtDate, fmtChg, fmtPct, decimalsOf, formatVol, fmtTickParts } from './util.js';

const XH_COLOR = '#9598A1';
const BG_TAG = '#1E222D';
const BORDER_TAG = '#2962FF';

export class CrosshairRenderer {
  mx = -1; // screen x (in device pixels)
  my = -1; // screen y (in device pixels)
  visible = false;

  update(x: number, y: number): void {
    this.mx = x;
    this.my = y;
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  draw(
    ovCtx: CanvasRenderingContext2D,
    yCtx: CanvasRenderingContext2D,
    xCtx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    tf: number,
    tickSize: number,
  ): void {
    if (!this.visible || this.mx < 0 || this.my < 0) return;

    const w = vp.w, h = vp.h;
    const dpr = vp.dpr || 1;
    const dec = decimalsOf(tickSize);

    // Garis vertikal di-SNAP ke tengah bar yang ditunjuk — standar chart profesional
    // (TradingView / ATAS / DeepChart): waktu yang terbaca = waktu bar tsb, bukan
    // posisi piksel bebas. Garis horizontal tetap 1:1 mengikuti kursor.
    const ci = bars.len > 0 ? Math.max(0, Math.round(vp.screenToX(this.mx))) : Math.round(vp.screenToX(this.mx));
    const cx = Math.round(vp.xToScreen(ci)) + 0.5;
    const cy = Math.round(this.my) + 0.5;

    // Timestamp bar yang ditunjuk (ekstrapolasi bila kursor di ruang kosong kanan data)
    let ts: number;
    if (bars.len > 0) {
      if (ci < bars.len) ts = bars.t[ci];
      else ts = bars.t[bars.len - 1] + (ci - (bars.len - 1)) * tf * 60;
    } else {
      ts = Math.floor(Date.now() / 1000);
    }

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

    // Vertical line across chart (di tengah bar ter-snap)
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
      yCtx.font = `bold ${Math.round(11 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
      yCtx.textAlign = 'center';
      yCtx.textBaseline = 'middle';
      yCtx.fillText(label, (yw + 5 * dpr) / 2, this.my);
      yCtx.restore();
    }

    // --- X-axis time & date badge (2 baris: waktu + tanggal) tepat di bawah bar yang ditunjuk ---
    const parts = fmtTickParts(ts, tf);
    const xh = xCtx.canvas.height;
    const xw = xCtx.canvas.width;

    xCtx.save();
    xCtx.font = `bold ${Math.round(10.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
    const twTop = xCtx.measureText(parts.top).width;
    xCtx.font = `${Math.round(9.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
    const twSub = xCtx.measureText(parts.sub).width;
    const tw = Math.max(twTop, twSub) + 14 * dpr;
    const bh = Math.min(27 * dpr, xh - 1);
    const bx = Math.max(tw / 2, Math.min(xw - tw / 2, cx));

    xCtx.fillStyle = BG_TAG;
    xCtx.fillRect(bx - tw / 2, 0, tw, bh);
    xCtx.strokeStyle = BORDER_TAG;
    xCtx.lineWidth = 1.5 * dpr;
    xCtx.strokeRect(bx - tw / 2 + 0.5, 0.5, tw - 1, bh - 1);

    xCtx.textAlign = 'center';
    xCtx.fillStyle = '#FFFFFF';
    xCtx.font = `bold ${Math.round(10.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
    xCtx.textBaseline = 'middle';
    xCtx.fillText(parts.top, bx, bh * 0.34);
    xCtx.fillStyle = '#9DB2C7';
    xCtx.font = `${Math.round(9.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
    xCtx.fillText(parts.sub, bx, bh * 0.72);
    xCtx.restore();
  }

  /** Draw simbol + OHLCV info at top-left of the chart (gaya DeepChart: judul simbol + TF di depan).
   *  Menampilkan bar yang di-hover crosshair, atau bar terakhir bila crosshair tidak aktif. */
  drawInfo(el: HTMLElement, bars: BarBuffer, vp: Viewport, tickSize: number, tf: number, title?: string): void {
    if (bars.len === 0) {
      el.innerHTML = title ? `<span style="color:#fff;font-weight:700">${title}</span>` : '';
      return;
    }

    let idx = this.visible ? Math.max(0, Math.round(vp.screenToX(this.mx))) : bars.len - 1;
    if (idx < 0 || idx >= bars.len) {
      idx = bars.len - 1;
    }

    const dec = decimalsOf(tickSize);
    const o = bars.o[idx], h = bars.h[idx], l = bars.l[idx], c = bars.c[idx], v = bars.v[idx];
    const diff = c - o;
    const pct = o !== 0 ? (diff / o) * 100 : 0;
    const bull = diff >= 0;
    const cls = bull ? 'up' : 'dn';

    // Data window gaya DeepChart: SIMBOL · tf  O: H: L: C: Chg: Vol: (label abu, nilai berwarna)
    el.innerHTML = (title ? `<span class="tt">${title}</span> ` : '')
      + `<span class="iv">O:</span> <span class="${cls}">${fmtPrice(o, dec)}</span> `
      + `<span class="iv">H:</span> <span class="${cls}">${fmtPrice(h, dec)}</span> `
      + `<span class="iv">L:</span> <span class="${cls}">${fmtPrice(l, dec)}</span> `
      + `<span class="iv">C:</span> <span class="${cls}">${fmtPrice(c, dec)}</span> `
      + `<span class="iv">Chg:</span> <span class="${cls}">${fmtChg(diff, dec)} (${fmtPct(pct)})</span> `
      + `<span class="iv">Vol:</span> <span class="iv">${formatVol(v)}</span>`;
  }
}
