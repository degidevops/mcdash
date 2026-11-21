// TpoRenderer — TPO profile blocks, POC/VAH/VAL level lines, session separators, nPOC extensions
import type { Viewport } from './viewport.js';
import type { BarBuffer } from './data.js';

export interface TpoRow {
  price: number;
  count: number;
  letters: string;
  is_poc: boolean;
  is_vah: boolean;
  is_val: boolean;
  in_va: boolean;
}

export interface TpoPeriod {
  name: string;
  start: number;
  end: number;
  tick: number;
  high: number;
  low: number;
  poc: number;
  vah: number;
  val: number;
  touched_poc: boolean;
  touched_vah: boolean;
  touched_val: boolean;
  rows: TpoRow[];
}

export interface TpoProfile {
  tag: string;
  mode: string;
  periods: TpoPeriod[];
}

export interface NakedLevel {
  name: string;
  kind: string;
  price: number;
  start_time: number;
}

export interface ChartTpoData {
  symbol: string;
  point: number;
  profiles: Record<string, TpoProfile>;
  naked: NakedLevel[];
}

export class TpoRenderer {
  private data: ChartTpoData | null = null;
  public activeTag: string | null = 'S'; // 'S' | 'D' | 'M' | 'W' | null (null = off)
  public showNPOC = true;
  public showLetters = true;

  setData(data: ChartTpoData): void {
    this.data = data;
  }

  toggleProfile(): string {
    const sequence = ['S', 'D', 'M', 'W', null];
    const curIdx = sequence.indexOf(this.activeTag);
    const nextIdx = (curIdx + 1) % sequence.length;
    this.activeTag = sequence[nextIdx];
    return this.activeTag ?? 'OFF';
  }

  toggleNPOC(): boolean {
    this.showNPOC = !this.showNPOC;
    return this.showNPOC;
  }

  /**
   * Find screen X for a unix timestamp (in seconds) by interpolating barBuffer timestamps.
   */
  private timeToScreenX(timeSec: number, bars: BarBuffer, vp: Viewport): number | null {
    const n = bars.len;
    if (n === 0) return null;

    const times = bars.t;
    // Outside left
    if (timeSec < times[0]) {
      if (n > 1) {
        const dt = times[1] - times[0];
        const offsetBars = dt > 0 ? (timeSec - times[0]) / dt : 0;
        return vp.xToScreen(offsetBars);
      }
      return vp.xToScreen(0);
    }
    // Outside right
    if (timeSec > times[n - 1]) {
      if (n > 1) {
        const dt = (times[n - 1] - times[0]) / (n - 1);
        const offsetBars = dt > 0 ? (timeSec - times[n - 1]) / dt : 0;
        return vp.xToScreen(n - 1 + offsetBars);
      }
      return vp.xToScreen(n - 1);
    }

    // Binary search for surrounding bars
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

    // lo is upper bound, hi is lower bound
    const idx0 = Math.max(0, hi);
    const idx1 = Math.min(n - 1, lo);
    if (idx0 === idx1) return vp.xToScreen(idx0);

    const t0 = times[idx0];
    const t1 = times[idx1];
    const frac = t1 > t0 ? (timeSec - t0) / (t1 - t0) : 0;
    const barPos = idx0 + frac;
    return vp.xToScreen(barPos);
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, bars: BarBuffer): void {
    if (!this.data || !this.activeTag) return;

    const profile = this.data.profiles[this.activeTag];
    if (!profile || !profile.periods || profile.periods.length === 0) return;

    const chartW = vp.w;
    const chartH = vp.chartH;
    const dpr = vp.dpr || 1;

    ctx.save();
    // Clip to chart drawing area (exclude axes & volume)
    ctx.beginPath();
    ctx.rect(0, 0, chartW, chartH);
    ctx.clip();

    // 1. Render each period (session separators, histogram blocks, and session levels)
    for (const period of profile.periods) {
      const xStart = this.timeToScreenX(period.start, bars, vp);
      const xEnd = this.timeToScreenX(period.end, bars, vp);

      if (xStart === null || xEnd === null) continue;

      // Skip if period is completely outside horizontal viewport
      if (Math.max(xStart, xEnd) < 0 || Math.min(xStart, xEnd) > chartW) {
        // Still might need to draw nPOC if it extends across screen
        if (this.showNPOC && !period.touched_poc) {
          this.drawNPocLine(ctx, period, xStart, chartW, vp, dpr);
        }
        continue;
      }

      // 1.1 Session Separator line at xStart
      ctx.save();
      ctx.strokeStyle = '#363A45';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(xStart, 0);
      ctx.lineTo(xStart, chartH);
      ctx.stroke();

      // Session Name Header
      ctx.setLineDash([]);
      ctx.font = `600 ${Math.round(10 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
      ctx.fillStyle = '#9598A1';
      ctx.textAlign = 'left';
      ctx.fillText(`╎ ${period.name}`, xStart + 4 * dpr, 18 * dpr);
      ctx.restore();

      // 1.2 TPO Histogram Blocks
      if (period.rows && period.rows.length > 0) {
        let maxCount = 1;
        for (const r of period.rows) {
          if (r.count > maxCount) maxCount = r.count;
        }

        const periodWidth = Math.abs(xEnd - xStart);
        const maxHistWidth = Math.min(periodWidth * 0.70, 280 * dpr);

        for (const row of period.rows) {
          if (row.price < vp.yMin || row.price > vp.yMax) continue;

          const yCenter = vp.yToScreen(row.price);
          const yNext = vp.yToScreen(row.price + period.tick);
          const rowHeight = Math.max(1 * dpr, Math.abs(yCenter - yNext));
          const barWidth = (row.count / maxCount) * maxHistWidth;

          // Color based on status
          if (row.is_poc) {
            ctx.fillStyle = 'rgba(239, 83, 80, 0.40)'; // POC highlight
          } else if (row.in_va) {
            ctx.fillStyle = 'rgba(41, 98, 255, 0.22)'; // Value Area
          } else {
            ctx.fillStyle = 'rgba(120, 123, 134, 0.12)'; // Outside VA
          }

          ctx.fillRect(xStart, yCenter - rowHeight / 2, barWidth, Math.max(1 * dpr, rowHeight - 0.5 * dpr));

          // Draw letters if zoomed in enough vertically
          if (this.showLetters && rowHeight >= 11 * dpr && barWidth > 15 * dpr) {
            ctx.font = `${Math.round(9 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
            ctx.fillStyle = row.is_poc ? '#FF8A80' : row.in_va ? '#90CAF9' : '#B0BEC5';
            ctx.textAlign = 'left';
            ctx.fillText(row.letters, xStart + 3 * dpr, yCenter + 3 * dpr, barWidth - 4 * dpr);
          }
        }
      }

      // 1.3 POC, VAH, VAL Lines for this period
      this.drawPeriodLevels(ctx, period, xStart, xEnd, vp, dpr);

      // 1.4 Naked POC extension if applicable
      if (this.showNPOC && !period.touched_poc) {
        this.drawNPocLine(ctx, period, xStart, chartW, vp, dpr);
      }
    }

    ctx.restore();
  }

  private drawPeriodLevels(
    ctx: CanvasRenderingContext2D,
    period: TpoPeriod,
    xStart: number,
    xEnd: number,
    vp: Viewport,
    dpr: number,
  ): void {
    const left = Math.min(xStart, xEnd);
    const right = Math.max(xStart, xEnd);

    // VAH Line (Gold dashed)
    if (period.vah > 0) {
      const yVah = vp.yToScreen(period.vah);
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(left, yVah);
      ctx.lineTo(right, yVah);
      ctx.stroke();

      // VAH badge
      this.drawLevelBadge(ctx, 'VAH', period.vah, right - 4 * dpr, yVah, '#FFD700', dpr);
      ctx.restore();
    }

    // VAL Line (Gold dashed)
    if (period.val > 0) {
      const yVal = vp.yToScreen(period.val);
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(left, yVal);
      ctx.lineTo(right, yVal);
      ctx.stroke();

      // VAL badge
      this.drawLevelBadge(ctx, 'VAL', period.val, right - 4 * dpr, yVal, '#FFD700', dpr);
      ctx.restore();
    }

    // POC Line (Red)
    if (period.poc > 0) {
      const yPoc = vp.yToScreen(period.poc);
      ctx.save();
      ctx.strokeStyle = '#FF5252';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(left, yPoc);
      ctx.lineTo(right, yPoc);
      ctx.stroke();

      // POC badge
      this.drawLevelBadge(ctx, 'POC', period.poc, right - 4 * dpr, yPoc, '#FF5252', dpr);
      ctx.restore();
    }
  }

  private drawNPocLine(
    ctx: CanvasRenderingContext2D,
    period: TpoPeriod,
    xStart: number,
    chartW: number,
    vp: Viewport,
    dpr: number,
  ): void {
    if (period.poc <= 0) return;
    const yPoc = vp.yToScreen(period.poc);
    if (yPoc < 0 || yPoc > vp.chartH) return;

    ctx.save();
    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, xStart), yPoc);
    ctx.lineTo(chartW, yPoc);
    ctx.stroke();

    // Naked POC Tag near right edge
    const tag = `nPOC ${period.name}: ${period.poc.toFixed(2)}`;
    ctx.font = `bold ${Math.round(9.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    const tw = ctx.measureText(tag).width;
    const pad = 6 * dpr;
    const badgeH = 16 * dpr;
    const bx = chartW - tw - pad * 2 - 4 * dpr;
    const by = yPoc - badgeH / 2;

    ctx.fillStyle = 'rgba(19, 23, 34, 0.90)';
    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([]);
    ctx.fillRect(bx, by, tw + pad * 2, badgeH);
    ctx.strokeRect(bx, by, tw + pad * 2, badgeH);

    ctx.fillStyle = '#FF5252';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, bx + pad, yPoc);

    ctx.restore();
  }

  private drawLevelBadge(
    ctx: CanvasRenderingContext2D,
    label: string,
    price: number,
    x: number,
    y: number,
    color: string,
    dpr: number,
  ): void {
    const text = `${label} ${price.toFixed(2)}`;
    ctx.font = `bold ${Math.round(9.5 * dpr)}px ui-monospace,SFMono-Regular,monospace`;
    const tw = ctx.measureText(text).width;
    const pad = 5 * dpr;
    const badgeH = 15 * dpr;
    const bx = x - tw - pad * 2;
    const by = y - badgeH / 2;

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(19, 23, 34, 0.90)';
    ctx.fillRect(bx, by, tw + pad * 2, badgeH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(bx, by, tw + pad * 2, badgeH);

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pad, y);
  }
}
