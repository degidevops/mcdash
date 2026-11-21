// Viewport: maps (barIndex, price) → screen pixels and back
import { clamp } from './util.js';

export class Viewport {
  // visible range in world coordinates
  xMin = 0;    // leftmost bar index
  xMax = 100;  // rightmost bar index
  yMin = 0;    // bottom price
  yMax = 100;  // top price

  /** When true, price scale automatically fits the visible bars */
  autoFitY = true;

  // screen dimensions
  w = 800;
  h = 600;

  // volume panel occupies bottom fraction of canvas
  volFrac = 0.18;

  /** Chart area height (above volume panel) */
  get chartH(): number { return this.h * (1 - this.volFrac); }
  /** Volume panel height */
  get volH(): number { return this.h * this.volFrac; }

  setSize(w: number, h: number): void { this.w = w; this.h = h; }

  /** Number of visible bars */
  get visibleBars(): number { return this.xMax - this.xMin; }

  /** Width of one bar in pixels */
  get barW(): number { return this.w / this.visibleBars; }

  /** Auto-fit Y range to data with padding */
  fitY(lo: number, hi: number, pad = 0.05): void {
    const rng = hi - lo || 1;
    this.yMin = lo - rng * pad;
    this.yMax = hi + rng * pad;
  }

  /** Reset Y back to auto-fit */
  resetY(lo: number, hi: number, pad = 0.05): void {
    this.autoFitY = true;
    this.fitY(lo, hi, pad);
  }

  // ---- World → Screen ----
  xToScreen(barIdx: number): number {
    return (barIdx - this.xMin) / (this.xMax - this.xMin) * this.w;
  }
  yToScreen(price: number): number {
    // price increases upward, screen Y increases downward
    return this.chartH * (1 - (price - this.yMin) / (this.yMax - this.yMin));
  }

  // ---- Screen → World ----
  screenToX(px: number): number { return this.xMin + px / this.w * (this.xMax - this.xMin); }
  screenToY(py: number): number { return this.yMin + (1 - py / this.chartH) * (this.yMax - this.yMin); }

  // ---- WebGL clip coordinates ----
  /** Returns [xMin, xMax, yMinWithVol, yMax] for WebGL clip coordinates */
  clipView(): [number, number, number, number] {
    const priceRange = this.yMax - this.yMin;
    const volWorldH = priceRange * this.volFrac / (1 - this.volFrac);
    return [this.xMin, this.xMax, this.yMin - volWorldH, this.yMax];
  }

  // ---- Interaction ----
  pan(dxPx: number, dyPx: number): void {
    const dxWorld = -dxPx / this.w * (this.xMax - this.xMin);
    const dyWorld = dyPx / this.chartH * (this.yMax - this.yMin);
    this.xMin += dxWorld; this.xMax += dxWorld;
    this.yMin += dyWorld; this.yMax += dyWorld;
  }

  zoom(factor: number, anchorPx: number): void {
    const anchorWorld = this.screenToX(anchorPx);
    const newRange = clamp((this.xMax - this.xMin) * factor, 10, 5000);
    const ratio = (anchorWorld - this.xMin) / (this.xMax - this.xMin);
    this.xMin = anchorWorld - newRange * ratio;
    this.xMax = anchorWorld + newRange * (1 - ratio);
  }

  zoomY(factor: number, anchorPy: number): void {
    const anchorPrice = this.screenToY(anchorPy);
    const newRange = (this.yMax - this.yMin) * factor;
    const ratio = (anchorPrice - this.yMin) / (this.yMax - this.yMin);
    this.yMin = anchorPrice - newRange * ratio;
    this.yMax = anchorPrice + newRange * (1 - ratio);
  }

  /** Scroll to show latest bars at right edge */
  scrollToEnd(totalBars: number, margin = 5): void {
    const vis = this.xMax - this.xMin;
    this.xMax = totalBars + margin;
    this.xMin = this.xMax - vis;
  }
}
