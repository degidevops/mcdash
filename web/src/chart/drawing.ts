// Drawing Tools — Models, Storage, Hit Testing, and Canvas 2D Overlay Rendering
// Part of Phase 4 & Phase 5: Professional Trading Chart (ATAS / DeepChart style)

import type { Viewport } from './viewport.js';
import type { BarBuffer } from './data.js';
import { fmtDateShort } from './util.js';

export type DrawingType = 'trendline' | 'hline' | 'vline' | 'fibonacci' | 'rectangle';

export interface DrawingPoint {
  time: number;  // unix timestamp in seconds
  price: number;
}

export interface DrawingStyle {
  color: string;
  width: number;
  dash?: number[];
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[]; // 1 point for hline/vline, 2 points for trendline/fibonacci/rectangle
  style: DrawingStyle;
  visible: boolean;
  locked: boolean;
}

export interface FibLevel {
  ratio: number;
  label: string;
  color: string;
  tint?: string;
}

export const FIB_LEVELS: FibLevel[] = [
  { ratio: 0.0,   label: '0.0%',   color: '#787B86' },
  { ratio: 0.236, label: '23.6%', color: '#F23645', tint: 'rgba(242, 54, 69, 0.08)' },
  { ratio: 0.382, label: '38.2%', color: '#FF9800', tint: 'rgba(255, 152, 0, 0.08)' },
  { ratio: 0.5,   label: '50.0%', color: '#4CAF50', tint: 'rgba(76, 175, 80, 0.08)' },
  { ratio: 0.618, label: '61.8%', color: '#089981', tint: 'rgba(8, 153, 129, 0.08)' },
  { ratio: 0.786, label: '78.6%', color: '#00BCD4', tint: 'rgba(0, 188, 212, 0.08)' },
  { ratio: 1.0,   label: '100.0%', color: '#787B86' },
];

/** Convert hex or rgb color to rgba with given alpha */
export function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    let c = color.slice(1);
    if (c.length === 3) {
      c = c.split('').map(x => x + x).join('');
    }
    if (c.length === 6) {
      const num = parseInt(c, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return color;
}

/** Distance from point (px, py) to line segment (x1, y1)-(x2, y2) */
export function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Convert unix timestamp in seconds to screen X coordinate */
export function timeToScreenX(timeSec: number, vp: Viewport, bars: BarBuffer): number {
  const n = bars.len;
  if (n === 0) return 0;
  if (n === 1) return vp.xToScreen(0);

  const times = bars.t;
  // Outside left
  if (timeSec < times[0]) {
    const dt = times[1] - times[0] || 60;
    const offsetBars = (timeSec - times[0]) / dt;
    return vp.xToScreen(offsetBars);
  }
  // Outside right
  if (timeSec > times[n - 1]) {
    const dt = (times[n - 1] - times[0]) / (n - 1) || 60;
    const offsetBars = (timeSec - times[n - 1]) / dt;
    return vp.xToScreen(n - 1 + offsetBars);
  }

  // Binary search for exact or surrounding bars
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] === timeSec) {
      return vp.xToScreen(mid);
    }
    if (times[mid] < timeSec) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const idx0 = Math.max(0, hi);
  const idx1 = Math.min(n - 1, lo);
  if (idx0 === idx1) return vp.xToScreen(idx0);

  const t0 = times[idx0];
  const t1 = times[idx1];
  const frac = t1 > t0 ? (timeSec - t0) / (t1 - t0) : 0;
  return vp.xToScreen(idx0 + frac);
}

/** Convert screen X coordinate to unix timestamp in seconds */
export function screenXToTime(screenX: number, vp: Viewport, bars: BarBuffer): number {
  const barIdx = vp.screenToX(screenX);
  const n = bars.len;
  if (n === 0) return Math.floor(Date.now() / 1000);
  if (n === 1) return bars.t[0];

  if (barIdx <= 0) {
    const dt = bars.t[1] - bars.t[0] || 60;
    return bars.t[0] + barIdx * dt;
  }
  if (barIdx >= n - 1) {
    const dt = (bars.t[n - 1] - bars.t[0]) / (n - 1) || 60;
    return bars.t[n - 1] + (barIdx - (n - 1)) * dt;
  }

  const i0 = Math.floor(barIdx);
  const frac = barIdx - i0;
  const t0 = bars.t[i0];
  const t1 = bars.t[i0 + 1];
  return t0 + frac * (t1 - t0);
}

/** Factory helper to instantiate a new Drawing */
export function createDrawing(
  type: DrawingType,
  points: DrawingPoint[],
  style?: Partial<DrawingStyle>
): Drawing {
  const defaultColors: Record<DrawingType, string> = {
    trendline: '#2962FF',
    hline: '#FFD700',
    vline: '#00BCD4',
    fibonacci: '#FF9800',
    rectangle: '#2962FF',
  };

  return {
    id: 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
    type,
    points,
    style: {
      color: style?.color ?? defaultColors[type] ?? '#2962FF',
      width: style?.width ?? (type === 'trendline' ? 2 : 1.5),
      ...(style?.dash ? { dash: style.dash } : type === 'hline' || type === 'vline' ? { dash: [4, 4] } : {}),
    },
    visible: true,
    locked: false,
  };
}

export interface HitResult {
  drawing: Drawing;
  hitType: 'point' | 'body';
  pointIndex?: number;
}

export class DrawingStore {
  drawings: Drawing[] = [];
  activeTool: DrawingType | null = null;
  selectedId: string | null = null;
  pendingPoints: DrawingPoint[] = [];
  previewPoint: DrawingPoint | null = null;

  defaultStyle: DrawingStyle = {
    color: '#2962FF',
    width: 2,
  };

  addDrawing(drawing: Drawing): void {
    this.drawings.push(drawing);
  }

  removeDrawing(id: string): void {
    const idx = this.drawings.findIndex(d => d.id === id);
    if (idx !== -1) {
      this.drawings.splice(idx, 1);
      if (this.selectedId === id) {
        this.selectedId = null;
      }
    }
  }

  updateDrawing(id: string, update: Partial<Drawing>): void {
    const d = this.getDrawing(id);
    if (d) {
      Object.assign(d, update);
    }
  }

  getDrawing(id: string): Drawing | undefined {
    return this.drawings.find(d => d.id === id);
  }

  clearAll(): void {
    this.drawings = [];
    this.selectedId = null;
    this.pendingPoints = [];
    this.previewPoint = null;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  setActiveTool(tool: DrawingType | null): void {
    this.activeTool = tool;
    this.pendingPoints = [];
    this.previewPoint = null;
  }

  cancelPending(): void {
    this.pendingPoints = [];
    this.previewPoint = null;
  }

  /**
   * Hit test a screen coordinate against existing drawings.
   * Tolerances are scaled by DPR for flawless mouse and touch precision.
   */
  hitTest(screenX: number, screenY: number, vp: Viewport, bars: BarBuffer): HitResult | null {
    if (bars.len === 0 || this.drawings.length === 0) return null;

    const dpr = vp.dpr || 1;
    const handleHitRadius = Math.max(12 * dpr, 22);
    const lineHitTolerance = Math.max(10 * dpr, 18);

    // 1. Check handles of selected drawing first (priority for resizing)
    if (this.selectedId) {
      const sel = this.getDrawing(this.selectedId);
      if (sel && sel.visible && !sel.locked) {
        if (sel.type === 'hline' && sel.points.length > 0) {
          const pt = sel.points[0];
          const x1 = pt.time ? timeToScreenX(pt.time, vp, bars) : vp.w / 2;
          const handleX = Math.max(30 * dpr, Math.min(vp.w - 50 * dpr, x1));
          const py = vp.yToScreen(pt.price);
          if (Math.hypot(screenX - handleX, screenY - py) <= handleHitRadius) {
            return { drawing: sel, hitType: 'point', pointIndex: 0 };
          }
        } else if (sel.type === 'rectangle' && sel.points.length >= 2) {
          const x1 = timeToScreenX(sel.points[0].time, vp, bars);
          const y1 = vp.yToScreen(sel.points[0].price);
          const x2 = timeToScreenX(sel.points[1].time, vp, bars);
          const y2 = vp.yToScreen(sel.points[1].price);
          const corners = [
            { x: x1, y: y1, idx: 0 },
            { x: x2, y: y2, idx: 1 },
            { x: x1, y: y2, idx: 2 },
            { x: x2, y: y1, idx: 3 },
          ];
          for (const c of corners) {
            if (Math.hypot(screenX - c.x, screenY - c.y) <= handleHitRadius) {
              return { drawing: sel, hitType: 'point', pointIndex: c.idx };
            }
          }
        } else {
          for (let i = 0; i < sel.points.length; i++) {
            const pt = sel.points[i];
            const px = timeToScreenX(pt.time, vp, bars);
            const py = sel.type === 'vline' ? vp.chartH / 2 : vp.yToScreen(pt.price);
            if (Math.hypot(screenX - px, screenY - py) <= handleHitRadius) {
              return { drawing: sel, hitType: 'point', pointIndex: i };
            }
          }
        }
      }
    }

    // 2. Check handles of all visible drawings (top-down in z-order)
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (!d.visible || d.locked) continue;
      if (d.type === 'hline' && d.points.length > 0) {
        const pt = d.points[0];
        const x1 = pt.time ? timeToScreenX(pt.time, vp, bars) : vp.w / 2;
        const handleX = Math.max(30 * dpr, Math.min(vp.w - 50 * dpr, x1));
        const py = vp.yToScreen(pt.price);
        if (Math.hypot(screenX - handleX, screenY - py) <= handleHitRadius) {
          return { drawing: d, hitType: 'point', pointIndex: 0 };
        }
      } else if (d.type === 'rectangle' && d.points.length >= 2) {
        const x1 = timeToScreenX(d.points[0].time, vp, bars);
        const y1 = vp.yToScreen(d.points[0].price);
        const x2 = timeToScreenX(d.points[1].time, vp, bars);
        const y2 = vp.yToScreen(d.points[1].price);
        const corners = [
          { x: x1, y: y1, idx: 0 },
          { x: x2, y: y2, idx: 1 },
          { x: x1, y: y2, idx: 2 },
          { x: x2, y: y1, idx: 3 },
        ];
        for (const c of corners) {
          if (Math.hypot(screenX - c.x, screenY - c.y) <= handleHitRadius) {
            return { drawing: d, hitType: 'point', pointIndex: c.idx };
          }
        }
      } else {
        for (let pIdx = 0; pIdx < d.points.length; pIdx++) {
          const pt = d.points[pIdx];
          const px = timeToScreenX(pt.time, vp, bars);
          const py = d.type === 'vline' ? vp.chartH / 2 : vp.yToScreen(pt.price);
          if (Math.hypot(screenX - px, screenY - py) <= handleHitRadius) {
            return { drawing: d, hitType: 'point', pointIndex: pIdx };
          }
        }
      }
    }

    // 3. Check drawing bodies (top-down in z-order)
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (!d.visible) continue;

      if (d.type === 'hline') {
        if (d.points.length < 1) continue;
        const py = vp.yToScreen(d.points[0].price);
        // Match line or right price badge
        if (Math.abs(screenY - py) <= lineHitTolerance && screenX >= 0 && screenX <= vp.w + 10 * dpr) {
          return { drawing: d, hitType: 'body' };
        }
      } else if (d.type === 'vline') {
        if (d.points.length < 1) continue;
        const px = timeToScreenX(d.points[0].time, vp, bars);
        if (Math.abs(screenX - px) <= lineHitTolerance && screenY >= 0 && screenY <= vp.chartH + 10 * dpr) {
          return { drawing: d, hitType: 'body' };
        }
      } else if (d.type === 'trendline') {
        if (d.points.length < 2) continue;
        const x1 = timeToScreenX(d.points[0].time, vp, bars);
        const y1 = vp.yToScreen(d.points[0].price);
        const x2 = timeToScreenX(d.points[1].time, vp, bars);
        const y2 = vp.yToScreen(d.points[1].price);
        if (distToSegment(screenX, screenY, x1, y1, x2, y2) <= lineHitTolerance) {
          return { drawing: d, hitType: 'body' };
        }
      } else if (d.type === 'rectangle') {
        if (d.points.length < 2) continue;
        const x1 = timeToScreenX(d.points[0].time, vp, bars);
        const y1 = vp.yToScreen(d.points[0].price);
        const x2 = timeToScreenX(d.points[1].time, vp, bars);
        const y2 = vp.yToScreen(d.points[1].price);

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        // Check inside rect (fill area)
        if (screenX >= minX - 4 * dpr && screenX <= maxX + 4 * dpr &&
            screenY >= minY - 4 * dpr && screenY <= maxY + 4 * dpr) {
          return { drawing: d, hitType: 'body' };
        }
        // Check edges with tolerance
        if (distToSegment(screenX, screenY, minX, minY, maxX, minY) <= lineHitTolerance ||
            distToSegment(screenX, screenY, maxX, minY, maxX, maxY) <= lineHitTolerance ||
            distToSegment(screenX, screenY, maxX, maxY, minX, maxY) <= lineHitTolerance ||
            distToSegment(screenX, screenY, minX, maxY, minX, minY) <= lineHitTolerance) {
          return { drawing: d, hitType: 'body' };
        }
      } else if (d.type === 'fibonacci') {
        if (d.points.length < 2) continue;
        const p1 = d.points[0];
        const p2 = d.points[1];
        const x1 = timeToScreenX(p1.time, vp, bars);
        const y1 = vp.yToScreen(p1.price);
        const x2 = timeToScreenX(p2.time, vp, bars);
        const y2 = vp.yToScreen(p2.price);

        if (distToSegment(screenX, screenY, x1, y1, x2, y2) <= lineHitTolerance) {
          return { drawing: d, hitType: 'body' };
        }

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const width = Math.max(maxX - minX, 60 * dpr);

        const priceDiff = p1.price - p2.price;
        for (const level of FIB_LEVELS) {
          const lvlPrice = p2.price + level.ratio * priceDiff;
          const lvlY = vp.yToScreen(lvlPrice);
          if (distToSegment(screenX, screenY, minX, lvlY, minX + width, lvlY) <= lineHitTolerance) {
            return { drawing: d, hitType: 'body' };
          }
        }

        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        if (screenX >= minX && screenX <= maxX + width && screenY >= minY && screenY <= maxY) {
          return { drawing: d, hitType: 'body' };
        }
      }
    }

    return null;
  }

  saveToStorage(symbol: string): void {
    try {
      const key = `mcdash_chart_drawings_${symbol.toUpperCase()}`;
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch (e) {
      console.warn('Failed to save drawings to localStorage:', e);
    }
  }

  loadFromStorage(symbol: string): void {
    try {
      const key = `mcdash_chart_drawings_${symbol.toUpperCase()}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.drawings = parsed.filter(d => (
          d &&
          typeof d.id === 'string' &&
          typeof d.type === 'string' &&
          Array.isArray(d.points)
        ));
      }
    } catch (e) {
      console.warn('Failed to load drawings from localStorage:', e);
      this.drawings = [];
    }
  }
}

export class DrawingRenderer {
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, bars: BarBuffer, store: DrawingStore): void {
    if (bars.len === 0) return;

    ctx.save();
    // Restrict drawing to chart area above volume panel
    ctx.beginPath();
    ctx.rect(0, 0, vp.w, vp.chartH);
    ctx.clip();

    // 1. Draw finalized drawings
    for (const drawing of store.drawings) {
      if (!drawing.visible) continue;
      const isSelected = drawing.id === store.selectedId;

      switch (drawing.type) {
        case 'trendline':
          this.drawTrendline(ctx, vp, bars, drawing, isSelected);
          break;
        case 'hline':
          this.drawHLine(ctx, vp, bars, drawing, isSelected);
          break;
        case 'vline':
          this.drawVLine(ctx, vp, bars, drawing, isSelected);
          break;
        case 'fibonacci':
          this.drawFibonacci(ctx, vp, bars, drawing, isSelected);
          break;
        case 'rectangle':
          this.drawRectangle(ctx, vp, bars, drawing, isSelected);
          break;
      }
    }

    // 2. Draw preview during creation
    this.drawCreationPreview(ctx, vp, bars, store);

    ctx.restore();
  }

  private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color = '#2962FF', dpr = 1): void {
    const r = Math.max(4.5 * dpr, 6);
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawTrendline(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    drawing: Drawing,
    isSelected: boolean
  ): void {
    if (drawing.points.length < 2) return;
    const dpr = vp.dpr || 1;
    const x1 = timeToScreenX(drawing.points[0].time, vp, bars);
    const y1 = vp.yToScreen(drawing.points[0].price);
    const x2 = timeToScreenX(drawing.points[1].time, vp, bars);
    const y2 = vp.yToScreen(drawing.points[1].price);

    ctx.save();
    ctx.strokeStyle = drawing.style.color;
    ctx.lineWidth = (drawing.style.width || 2) * dpr;
    if (drawing.style.dash && drawing.style.dash.length > 0) {
      ctx.setLineDash(drawing.style.dash.map(v => v * dpr));
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();

    if (isSelected) {
      this.drawHandle(ctx, x1, y1, drawing.style.color, dpr);
      this.drawHandle(ctx, x2, y2, drawing.style.color, dpr);
    }
  }

  private drawHLine(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    drawing: Drawing,
    isSelected: boolean
  ): void {
    if (drawing.points.length < 1) return;
    const dpr = vp.dpr || 1;
    const price = drawing.points[0].price;
    const y = vp.yToScreen(price);
    const x1 = drawing.points[0].time ? timeToScreenX(drawing.points[0].time, vp, bars) : vp.w / 2;

    ctx.save();
    ctx.strokeStyle = drawing.style.color;
    ctx.lineWidth = (drawing.style.width || 1.5) * dpr;
    if (drawing.style.dash && drawing.style.dash.length > 0) {
      ctx.setLineDash(drawing.style.dash.map(v => v * dpr));
    } else {
      ctx.setLineDash([]);
    }

    // Full horizontal line across chart
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(vp.w, y);
    ctx.stroke();
    ctx.restore();

    // Price badge on the right
    ctx.save();
    const label = price.toFixed(2);
    ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    const textW = ctx.measureText(label).width;
    const badgeW = textW + 10 * dpr;
    const badgeH = 18 * dpr;
    const badgeX = vp.w - badgeW - 4 * dpr;
    const badgeY = y - badgeH / 2;

    ctx.fillStyle = drawing.style.color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 2 * dpr) : ctx.rect(badgeX, badgeY, badgeW, badgeH);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + badgeW / 2, y);
    ctx.restore();

    if (isSelected) {
      const handleX = Math.max(30 * dpr, Math.min(vp.w - 50 * dpr, x1));
      this.drawHandle(ctx, handleX, y, drawing.style.color, dpr);
    }
  }

  private drawVLine(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    drawing: Drawing,
    isSelected: boolean
  ): void {
    if (drawing.points.length < 1) return;
    const dpr = vp.dpr || 1;
    const time = drawing.points[0].time;
    const px = timeToScreenX(time, vp, bars);

    ctx.save();
    ctx.strokeStyle = drawing.style.color;
    ctx.lineWidth = (drawing.style.width || 1.5) * dpr;
    if (drawing.style.dash && drawing.style.dash.length > 0) {
      ctx.setLineDash(drawing.style.dash.map(v => v * dpr));
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, vp.chartH);
    ctx.stroke();
    ctx.restore();

    // Date badge at the bottom
    ctx.save();
    const label = fmtDateShort(time);
    ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    const textW = ctx.measureText(label).width;
    const badgeW = textW + 10 * dpr;
    const badgeH = 18 * dpr;
    const badgeX = px - badgeW / 2;
    const badgeY = vp.chartH - badgeH - 4 * dpr;

    ctx.fillStyle = drawing.style.color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 2 * dpr) : ctx.rect(badgeX, badgeY, badgeW, badgeH);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);
    ctx.restore();

    if (isSelected) {
      this.drawHandle(ctx, px, vp.chartH / 2, drawing.style.color, dpr);
    }
  }

  private drawFibonacci(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    drawing: Drawing,
    isSelected: boolean
  ): void {
    if (drawing.points.length < 2) return;
    const dpr = vp.dpr || 1;
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];
    const x1 = timeToScreenX(p1.time, vp, bars);
    const y1 = vp.yToScreen(p1.price);
    const x2 = timeToScreenX(p2.time, vp, bars);
    const y2 = vp.yToScreen(p2.price);

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const width = Math.max(maxX - minX, 60 * dpr);

    // Diagonal reference line between Point 1 and Point 2
    ctx.save();
    ctx.strokeStyle = colorWithAlpha(drawing.style.color, 0.4);
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();

    const priceDiff = p1.price - p2.price;

    // Calculate level positions
    const levelsCalculated = FIB_LEVELS.map(lvl => {
      const price = p2.price + lvl.ratio * priceDiff;
      const y = vp.yToScreen(price);
      return { ...lvl, price, y };
    });

    // Draw background tints between adjacent key levels
    ctx.save();
    for (let i = 0; i < levelsCalculated.length - 1; i++) {
      const lvlA = levelsCalculated[i];
      const lvlB = levelsCalculated[i + 1];
      const tint = lvlB.tint ?? 'rgba(255, 255, 255, 0.03)';
      const topY = Math.min(lvlA.y, lvlB.y);
      const height = Math.abs(lvlA.y - lvlB.y);

      ctx.fillStyle = tint;
      ctx.fillRect(minX, topY, width, height);
    }
    ctx.restore();

    // Draw horizontal lines and level text labels
    ctx.save();
    ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    ctx.textBaseline = 'bottom';

    for (const lvl of levelsCalculated) {
      // Horizontal level line
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash(lvl.ratio === 0 || lvl.ratio === 1 ? [] : [2 * dpr, 2 * dpr]);
      ctx.beginPath();
      ctx.moveTo(minX, lvl.y);
      ctx.lineTo(minX + width, lvl.y);
      ctx.stroke();

      // Label: e.g. "61.8% (2745.20)"
      const text = `${lvl.label} (${lvl.price.toFixed(2)})`;
      ctx.fillStyle = lvl.color;
      ctx.textAlign = 'left';
      ctx.fillText(text, minX + 4 * dpr, lvl.y - 2 * dpr);
    }
    ctx.restore();

    if (isSelected) {
      this.drawHandle(ctx, x1, y1, drawing.style.color, dpr);
      this.drawHandle(ctx, x2, y2, drawing.style.color, dpr);
    }
  }

  private drawRectangle(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    drawing: Drawing,
    isSelected: boolean
  ): void {
    if (drawing.points.length < 2) return;
    const dpr = vp.dpr || 1;
    const x1 = timeToScreenX(drawing.points[0].time, vp, bars);
    const y1 = vp.yToScreen(drawing.points[0].price);
    const x2 = timeToScreenX(drawing.points[1].time, vp, bars);
    const y2 = vp.yToScreen(drawing.points[1].price);

    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.max(1, Math.abs(x2 - x1));
    const rh = Math.max(1, Math.abs(y2 - y1));

    ctx.save();
    // Semi-transparent fill
    ctx.fillStyle = colorWithAlpha(drawing.style.color, 0.12);
    ctx.fillRect(rx, ry, rw, rh);

    // Border stroke
    ctx.strokeStyle = drawing.style.color;
    ctx.lineWidth = (drawing.style.width || 1.5) * dpr;
    if (drawing.style.dash && drawing.style.dash.length > 0) {
      ctx.setLineDash(drawing.style.dash.map(v => v * dpr));
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();

    if (isSelected) {
      this.drawHandle(ctx, x1, y1, drawing.style.color, dpr);
      this.drawHandle(ctx, x2, y2, drawing.style.color, dpr);
      this.drawHandle(ctx, x1, y2, drawing.style.color, dpr);
      this.drawHandle(ctx, x2, y1, drawing.style.color, dpr);
    }
  }

  private drawCreationPreview(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    bars: BarBuffer,
    store: DrawingStore
  ): void {
    if (!store.activeTool || !store.previewPoint) return;
    const dpr = vp.dpr || 1;

    if (store.activeTool === 'hline') {
      const y = vp.yToScreen(store.previewPoint.price);
      ctx.save();
      ctx.strokeStyle = store.defaultStyle.color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(vp.w, y);
      ctx.stroke();

      const label = store.previewPoint.price.toFixed(2);
      ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
      const textW = ctx.measureText(label).width;
      const badgeW = textW + 10 * dpr;
      const badgeH = 18 * dpr;
      const badgeX = vp.w - badgeW - 4 * dpr;
      const badgeY = y - badgeH / 2;

      ctx.fillStyle = store.defaultStyle.color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 2 * dpr) : ctx.rect(badgeX, badgeY, badgeW, badgeH);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + badgeW / 2, y);
      ctx.restore();
      return;
    }

    if (store.activeTool === 'vline') {
      const px = timeToScreenX(store.previewPoint.time, vp, bars);
      ctx.save();
      ctx.strokeStyle = store.defaultStyle.color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, vp.chartH);
      ctx.stroke();

      const label = fmtDateShort(store.previewPoint.time);
      ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
      const textW = ctx.measureText(label).width;
      const badgeW = textW + 10 * dpr;
      const badgeH = 18 * dpr;
      const badgeX = px - badgeW / 2;
      const badgeY = vp.chartH - badgeH - 4 * dpr;

      ctx.fillStyle = store.defaultStyle.color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 2 * dpr) : ctx.rect(badgeX, badgeY, badgeW, badgeH);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);
      ctx.restore();
      return;
    }

    if (store.pendingPoints.length === 1) {
      const pt1 = store.pendingPoints[0];
      const pt2 = store.previewPoint;
      const previewDrawing: Drawing = {
        id: '__preview__',
        type: store.activeTool,
        points: [pt1, pt2],
        style: { ...store.defaultStyle, dash: [4, 4] },
        visible: true,
        locked: false,
      };

      ctx.save();
      ctx.globalAlpha = 0.75;
      switch (store.activeTool) {
        case 'trendline':
          this.drawTrendline(ctx, vp, bars, previewDrawing, false);
          break;
        case 'rectangle':
          this.drawRectangle(ctx, vp, bars, previewDrawing, false);
          break;
        case 'fibonacci':
          this.drawFibonacci(ctx, vp, bars, previewDrawing, false);
          break;
      }
      ctx.restore();

      // Show handle at point 1
      const x1 = timeToScreenX(pt1.time, vp, bars);
      const y1 = vp.yToScreen(pt1.price);
      this.drawHandle(ctx, x1, y1, store.defaultStyle.color, dpr);
    }
  }
}
