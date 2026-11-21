import { niceStep, niceTimeStep, fmtPrice, fmtTime, decimalsOf } from './util.js';
const TEXT_COLOR = '#787B86';
const CUR_COLOR = '#2962FF';
const BULL_COLOR = '#26A69A';
const BEAR_COLOR = '#EF5350';
export class AxisRenderer {
    drawY(ctx, vp, tickSize, lastPrice, openPrice) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const priceRange = vp.yMax - vp.yMin;
        const step = niceStep(priceRange, Math.floor(vp.chartH / 50));
        const dec = Math.max(decimalsOf(tickSize), decimalsOf(step));
        const pStart = Math.ceil(vp.yMin / step) * step;
        ctx.font = '11px ui-monospace,SFMono-Regular,monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = TEXT_COLOR;
        for (let p = pStart; p <= vp.yMax; p += step) {
            const y = vp.yToScreen(p);
            if (y < 4 || y > vp.chartH - 4)
                continue;
            ctx.fillText(fmtPrice(p, dec), 6, y);
        }
        // current price marker
        if (lastPrice > 0 && lastPrice >= vp.yMin && lastPrice <= vp.yMax) {
            const y = Math.round(vp.yToScreen(lastPrice));
            const bull = lastPrice >= openPrice;
            const bg = bull ? BULL_COLOR : BEAR_COLOR;
            ctx.fillStyle = bg;
            ctx.fillRect(0, y - 10, w, 20);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px ui-monospace,SFMono-Regular,monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fmtPrice(lastPrice, dec), w / 2, y);
        }
    }
    drawX(ctx, vp, bars, tf) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const rangeSec = vp.visibleBars * tf * 60;
        const tStep = niceTimeStep(rangeSec, Math.floor(w / 100));
        const tStepBars = tStep / (tf * 60);
        if (tStepBars <= 0)
            return;
        ctx.font = '10px ui-monospace,SFMono-Regular,monospace';
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const iStart = Math.ceil(vp.xMin / tStepBars) * tStepBars;
        for (let bi = iStart; bi <= vp.xMax; bi += tStepBars) {
            const x = vp.xToScreen(bi);
            if (x < 20 || x > w - 20)
                continue;
            const idx = Math.round(bi);
            if (idx < 0 || idx >= bars.len)
                continue;
            const ts = bars.t[idx];
            ctx.fillText(fmtTime(ts, tf), x, 4);
        }
    }
}
