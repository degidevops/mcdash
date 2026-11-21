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
      if (x < 35 * dpr || x > w - 35 * dpr) continue;
      if (x - lastLabelX < 68 * dpr) continue; // Prevent overlapping labels

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

      const isNewDay = prevTs > 0 && !isSameDay(prevTs, ts);
      const isDailyOrHigher = tf >= 1440;

      // Top tick mark
      ctx.strokeStyle = isNewDay ? '#4C525E' : BORDER_COLOR;
      ctx.lineWidth = (isNewDay ? 1.5 : 1) * dpr;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, (isNewDay ? 6 : 4) * dpr);
      ctx.stroke();

      if (isDailyOrHigher) {
        // Daily / Weekly: Line 1 = "21 Nov", Line 2 = "2026"
        const d = new Date(ts * 1000);
        ctx.font = `bold ${Math.round(10.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = DATE_COLOR;
        ctx.fillText(fmtDateShort(ts), x, 11 * dpr);

        ctx.font = `${Math.round(9 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = TEXT_COLOR;
        ctx.fillText(String(d.getFullYear()), x, 22 * dpr);
      } else if (isNewDay || lastLabelX === -999) {
        // Day boundary or first visible label: prominent date tag with time
        ctx.save();
        const dateStr = fmtDateShort(ts);
        const timeStr = fmtTime(ts, tf);

        // Date & Time badge
        ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(dateStr, x, 10.5 * dpr);

        ctx.font = `${Math.round(9 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = '#26A69A'; // Highlighted color for session start
        ctx.fillText(timeStr, x, 21.5 * dpr);
        ctx.restore();
      } else {
        // Regular intraday tick: Line 1 = "14:00" (bold), Line 2 = "21 Nov" (date info)
        ctx.font = `bold ${Math.round(10.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = DATE_COLOR;
        ctx.fillText(fmtTime(ts, tf), x, 10.5 * dpr);

        ctx.font = `${Math.round(9 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
        ctx.fillStyle = TEXT_COLOR;
        ctx.fillText(fmtDateShort(ts), x, 21.5 * dpr);
      }

      prevTs = ts;
      lastLabelX = x;
    }
  }
}
