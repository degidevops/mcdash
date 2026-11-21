// Viewport: maps (barIndex, price) → screen pixels and back
import { clamp } from './util.js';
export class Viewport {
    // visible range in world coordinates
    xMin = 0; // leftmost bar index
    xMax = 100; // rightmost bar index
    yMin = 0; // bottom price
    yMax = 100; // top price
    // screen dimensions
    w = 800;
    h = 600;
    // volume panel occupies bottom fraction of canvas
    volFrac = 0.18;
    /** Chart area height (above volume panel) */
    get chartH() { return this.h * (1 - this.volFrac); }
    /** Volume panel height */
    get volH() { return this.h * this.volFrac; }
    setSize(w, h) { this.w = w; this.h = h; }
    /** Number of visible bars */
    get visibleBars() { return this.xMax - this.xMin; }
    /** Width of one bar in pixels */
    get barW() { return this.w / this.visibleBars; }
    /** Auto-fit Y range to data with padding */
    fitY(lo, hi, pad = 0.05) {
        const rng = hi - lo || 1;
        this.yMin = lo - rng * pad;
        this.yMax = hi + rng * pad;
    }
    // ---- World → Screen ----
    xToScreen(barIdx) {
        return (barIdx - this.xMin) / (this.xMax - this.xMin) * this.w;
    }
    yToScreen(price) {
        // price increases upward, screen Y increases downward
        return this.chartH * (1 - (price - this.yMin) / (this.yMax - this.yMin));
    }
    // ---- Screen → World ----
    screenToX(px) { return this.xMin + px / this.w * (this.xMax - this.xMin); }
    screenToY(py) { return this.yMin + (1 - py / this.chartH) * (this.yMax - this.yMin); }
    // ---- WebGL clip coordinates ----
    /** Returns [xMin, xMax, yMinWithVol, yMax] for WebGL clip coordinates */
    clipView() {
        const priceRange = this.yMax - this.yMin;
        const volWorldH = priceRange * this.volFrac / (1 - this.volFrac);
        return [this.xMin, this.xMax, this.yMin - volWorldH, this.yMax];
    }
    // ---- Interaction ----
    pan(dxPx, dyPx) {
        const dxWorld = -dxPx / this.w * (this.xMax - this.xMin);
        const dyWorld = dyPx / this.chartH * (this.yMax - this.yMin);
        this.xMin += dxWorld;
        this.xMax += dxWorld;
        this.yMin += dyWorld;
        this.yMax += dyWorld;
    }
    zoom(factor, anchorPx) {
        const anchorWorld = this.screenToX(anchorPx);
        const newRange = clamp((this.xMax - this.xMin) * factor, 10, 5000);
        const ratio = (anchorWorld - this.xMin) / (this.xMax - this.xMin);
        this.xMin = anchorWorld - newRange * ratio;
        this.xMax = anchorWorld + newRange * (1 - ratio);
    }
    zoomY(factor, anchorPy) {
        const anchorPrice = this.screenToY(anchorPy);
        const newRange = (this.yMax - this.yMin) * factor;
        const ratio = (anchorPrice - this.yMin) / (this.yMax - this.yMin);
        this.yMin = anchorPrice - newRange * ratio;
        this.yMax = anchorPrice + newRange * (1 - ratio);
    }
    /** Scroll to show latest bars at right edge */
    scrollToEnd(totalBars, margin = 5) {
        const vis = this.xMax - this.xMin;
        this.xMax = totalBars + margin;
        this.xMin = this.xMax - vis;
    }
}
