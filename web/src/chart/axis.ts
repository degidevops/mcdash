// AxisRenderer — Canvas 2D price (Y) and time (X) axis labels
import type { Viewport } from './viewport.js';
import type { BarBuffer } from './data.js';
import { niceStep, niceTimeStep, fmtPrice, fmtTime, decimalsOf } from './util.js';

const TEXT_COLOR = '#787B86';
const CUR_COLOR = '#2962FF';
const BULL_COLOR = '#26A69A';
const BEAR_COLOR = '#EF5350';
const BORDER_COLOR = '#363A45';

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
    ctx.clearRect(0, 0, w, h);

    const priceRange = vp.yMax - vp.yMin;
    if (priceRange <= 0) return;

    const step = niceStep(priceRange, Math.max(2, Math.floor(vp.chartH / 45)));
    const dec = Math.max(decimalsOf(tickSize), decimalsOf(step));
    const pStart = Math.ceil(vp.yMin / step) * step;

    ctx.font = '11px ui-monospace,SFMono-Regular,monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT_COLOR;

    for (let p = pStart; p <= vp.yMax; p += step) {
      const y = vp.yToScreen(p);
      if (y < 6 || y > vp.chartH - 6) continue;
      // Tick line
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(4, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillText(fmtPrice(p, dec), 7, y);
    }

    // current price marker
    if (lastPrice > 0 && lastPrice >= vp.yMin && lastPrice <= vp.yMax) {
      const y = Math.round(vp.yToScreen(lastPrice));
      const bull = lastPrice >= openPrice;
      const bg = bull ? BULL_COLOR : BEAR_COLOR;

      ctx.fillStyle = bg;
      ctx.beginPath();
      const h2 = 10;
      ctx.moveTo(0, y);
      ctx.lineTo(5, y - h2);
      ctx.lineTo(w, y - h2);
      ctx.lineTo(w, y + h2);
      ctx.lineTo(5, y + h2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px ui-monospace,SFMono-Regular,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(lastPrice, dec), (w + 4) / 2, y);

      // Countdown Bar Timer (Teks Waktu di Sumbu Y)
      if (lastBarTs > 0 && tf > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const nextBarTs = lastBarTs + tf * 60;
        const remSec = Math.max(0, nextBarTs - nowSec);
        const hh = Math.floor(remSec / 3600);
        const mm = String(Math.floor((remSec % 3600) / 60)).padStart(2, '0');
        const ss = String(remSec % 60).padStart(2, '0');
        const timeStr = hh > 0 ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;

        const timeY = y + 14;
        if (timeY + 14 <= vp.chartH) {
          ctx.save();
          ctx.fillStyle = 'rgba(26, 30, 42, 0.9)';
          ctx.fillRect(3, timeY - 1, w - 6, 15);
          ctx.strokeStyle = '#363A45';
          ctx.lineWidth = 1;
          ctx.strokeRect(3.5, timeY - 0.5, w - 7, 14);

          ctx.fillStyle = '#B2B5BE';
          ctx.font = '10px ui-monospace,SFMono-Regular,monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`⏱ ${timeStr}`, w / 2, timeY + 6.5);
          ctx.restore();
        }
      }
    }
  }

  drawX(ctx: CanvasRenderingContext2D, vp: Viewport, bars: BarBuffer, tf: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (vp.visibleBars <= 0) return;

    const rangeSec = vp.visibleBars * tf * 60;
    const tStep = niceTimeStep(rangeSec, Math.max(2, Math.floor(w / 110)));
    const tStepBars = tStep / (tf * 60);

    if (tStepBars <= 0) return;

    ctx.font = '10px ui-monospace,SFMono-Regular,monospace';
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const iStart = Math.ceil(vp.xMin / tStepBars) * tStepBars;
    let lastLabelX = -999;

    for (let bi = iStart; bi <= vp.xMax + tStepBars; bi += tStepBars) {
      const x = Math.round(vp.xToScreen(bi));
      if (x < 25 || x > w - 25) continue;
      if (x - lastLabelX < 55) continue; // Prevent overlapping labels

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

      // Small tick mark at top of x-axis
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 4);
      ctx.stroke();

      ctx.fillText(fmtTime(ts, tf), x, h / 2 + 1);
      lastLabelX = x;
    }
  }
}
