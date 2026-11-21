// AxisRenderer — Canvas 2D price (Y) and time (X) axis labels with ATAS / DeepChart styling
import type { Viewport } from './viewport.js';
import type { BarBuffer } from './data.js';
import { niceStep, niceTimeStep, fmtPrice, fmtTime, fmtDateShort, isSameDay, decimalsOf } from './util.js';

const TEXT_COLOR = '#787B86';
const DATE_COLOR = '#D1D4DC';
const BULL_COLOR = '#26A69A';
const BEAR_COLOR = '#EF5350';
const BORDER_COLOR = '#363A45';
const MAJOR_BORDER = '#4C525E';

export class AxisRenderer {
  drawY(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    tickSize: number,
    lastPrice: number,
    openPrice: number,
    lastBarTs = 0,
    tf = 60,
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const dpr = vp.dpr || 1;
    ctx.clearRect(0, 0, w, h);

    const priceRange = vp.yMax - vp.yMin;
    if (priceRange <= 0) return;

    const step = niceStep(priceRange, Math.max(2, Math.floor(vp.chartH / (45 * dpr))));
    const dec = Math.max(decimalsOf(tickSize), decimalsOf(step));
    const pStart = Math.ceil(vp.yMin / step) * step;

    ctx.font = `${Math.round(11 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT_COLOR;

    for (let p = pStart; p <= vp.yMax; p += step) {
      const y = vp.yToScreen(p);
      if (y < 8 * dpr || y > vp.chartH - 8 * dpr) continue;

      // Tick line
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(4 * dpr, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillText(fmtPrice(p, dec), 7 * dpr, y);
    }

    // Current price marker (ATAS / DeepChart style arrow tag)
    if (lastPrice > 0 && lastPrice >= vp.yMin && lastPrice <= vp.yMax) {
      const y = Math.round(vp.yToScreen(lastPrice));
      const bull = lastPrice >= openPrice;
      const bg = bull ? BULL_COLOR : BEAR_COLOR;
      const h2 = 10 * dpr;

      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(6 * dpr, y - h2);
      ctx.lineTo(w, y - h2);
      ctx.lineTo(w, y + h2);
      ctx.lineTo(6 * dpr, y + h2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(11 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(lastPrice, dec), (w + 4 * dpr) / 2, y);

      // Countdown Bar Timer (Teks Waktu di Sumbu Y di bawah harga)
      if (lastBarTs > 0 && tf > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const nextBarTs = lastBarTs + tf * 60;
        const remSec = Math.max(0, nextBarTs - nowSec);
        const hh = Math.floor(remSec / 3600);
        const mm = String(Math.floor((remSec % 3600) / 60)).padStart(2, '0');
        const ss = String(remSec % 60).padStart(2, '0');
        const timeStr = hh > 0 ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;

        const timeY = y + 13 * dpr;
        const pillH = 15 * dpr;
        if (timeY + pillH <= vp.chartH) {
          ctx.save();
          ctx.fillStyle = 'rgba(26, 30, 42, 0.92)';
          ctx.fillRect(3 * dpr, timeY, w - 6 * dpr, pillH);
          ctx.strokeStyle = '#363A45';
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(3 * dpr + 0.5, timeY + 0.5, w - 6 * dpr - 1, pillH - 1);

          ctx.fillStyle = '#B2B5BE';
          ctx.font = `bold ${Math.round(9.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`⏱ ${timeStr}`, w / 2, timeY + pillH / 2);
          ctx.restore();
        }
      }
    }
  }

  drawX(ctx: CanvasRenderingContext2D, vp: Viewport, bars: BarBuffer, tf: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const dpr = vp.dpr || 1;
    ctx.clearRect(0, 0, w, h);

    if (vp.visibleBars <= 0) return;

    const rangeSec = vp.visibleBars * tf * 60;
    const tStep = niceTimeStep(rangeSec, Math.max(2, Math.floor(w / (110 * dpr))));
    const tStepBars = tStep / (tf * 60);

    if (tStepBars <= 0) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const iStart = Math.ceil(vp.xMin / tStepBars) * tStepBars;
    let lastLabelX = -999;
    let prevTs = 0;

    for (let bi = iStart; bi <= vp.xMax + tStepBars; bi += tStepBars) {
      const x = Math.round(vp.xToScreen(bi));
      if (x < 30 * dpr || x > w - 30 * dpr) continue;
      if (x - lastLabelX < 65 * dpr) continue; // Prevent overlapping labels

      let ts: number;
      const idx = Math.round(bi);
      if (bars.len > 0) {
        if (idx >= 0 && idx < bars.len) {
          ts = bars.t[idx];
        } else if (idx >= bars.len) {
          ts = bars.t[bars.len - 1] + (idx - (bars.len - 1)) * tf * 60;
        } else {
          ts = bars.t[0] + idx * tf * 60;
        }
      } else {
        ts = Math.floor(Date.now() / 1000) + (bi - 100) * tf * 60;
      }

      // Check if this label marks a new calendar day
      const isNewDay = prevTs > 0 && !isSameDay(prevTs, ts);
      const isDailyOrHigher = tf >= 1440;

      if (isDailyOrHigher) {
        // Daily or higher: show Date e.g. "21 Nov"
        ctx.font = `${Math.round(10.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = TEXT_COLOR;
        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, 4 * dpr);
        ctx.stroke();

        ctx.fillText(fmtDateShort(ts), x, h / 2);
      } else if (isNewDay || lastLabelX === -999) {
        // First visible label or day transition: prominent Date tag (e.g. "21 Nov")
        ctx.font = `bold ${Math.round(10.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = DATE_COLOR;

        // Prominent tick mark on day boundary
        ctx.strokeStyle = MAJOR_BORDER;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, 6 * dpr);
        ctx.stroke();

        const label = fmtDateShort(ts);
        ctx.fillText(label, x, h / 2);
      } else {
        // Regular intraday tick: show Time "HH:mm"
        ctx.font = `${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = TEXT_COLOR;

        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, 4 * dpr);
        ctx.stroke();

        ctx.fillText(fmtTime(ts, tf), x, h / 2);
      }

      prevTs = ts;
      lastLabelX = x;
    }
  }
}
