// GridRenderer — Canvas 2D grid lines on the overlay canvas
import type { Viewport } from './viewport.js';
import { niceStep, niceTimeStep } from './util.js';

const GRID = '#1E222D';
const VOL_SEPARATOR = '#363A45';

export class GridRenderer {
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, tfSec: number): void {
    const w = vp.w, h = vp.h;
    const dpr = vp.dpr || 1;
    ctx.clearRect(0, 0, w, h);

    // --- Horizontal price grid ---
    const priceRange = vp.yMax - vp.yMin;
    const step = niceStep(priceRange, Math.floor(vp.chartH / (50 * dpr)));
    const pStart = Math.ceil(vp.yMin / step) * step;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let p = pStart; p <= vp.yMax; p += step) {
      const y = Math.round(vp.yToScreen(p)) + 0.5;
      if (y < 0 || y > vp.chartH) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // --- Vertical time grid ---
    const visibleBars = vp.visibleBars;
    const rangeSec = visibleBars * tfSec * 60; // tf is in minutes
    const tStep = niceTimeStep(rangeSec, Math.floor(w / (100 * dpr)));
    const tStepBars = tStep / (tfSec * 60); // time step in bar-index units

    if (tStepBars > 0) {
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      const iStart = Math.ceil(vp.xMin / tStepBars) * tStepBars;
      for (let bi = iStart; bi <= vp.xMax; bi += tStepBars) {
        const x = Math.round(vp.xToScreen(bi)) + 0.5;
        if (x < 0 || x > w) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
    }

    // --- Volume separator line ---
    const volY = Math.round(vp.chartH) + 0.5;
    ctx.strokeStyle = VOL_SEPARATOR;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, volY);
    ctx.lineTo(w, volY);
    ctx.stroke();
  }
}
