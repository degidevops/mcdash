import { settings } from './settings.js';
export class TpoRenderer {
    profiles = {};
    cache = {};
    activeTag = 'S'; // 'S' | 'D' | 'M' | 'W' | null (null = off)
    showNPOC = true;
    showNVA = true;
    showLetters = true;
    /** Nilai `since` untuk permintaan berikutnya: baris periode yang lebih lama dari ini sudah ada di cache. */
    since(tag) {
        const periods = this.profiles[tag]?.periods;
        if (!periods)
            return undefined;
        for (let i = periods.length - 1; i >= 0; i--) {
            if (!periods[i].developing)
                return periods[i].start;
        }
        return undefined;
    }
    /** Gabungkan jawaban server dengan cache. false = ada baris yang tidak dimiliki -> minta ulang penuh. */
    merge(tag, data) {
        const profile = data.profiles?.[tag];
        if (!profile) {
            delete this.profiles[tag];
            delete this.cache[tag];
            return true;
        }
        const old = this.cache[tag] ?? new Map();
        const next = new Map();
        for (const p of profile.periods) {
            if (!p.rows) {
                const hit = old.get(p.start);
                if (!hit || hit.sig !== p.sig) {
                    delete this.cache[tag];
                    delete this.profiles[tag];
                    return false;
                }
                p.rows = hit.rows;
            }
            next.set(p.start, { sig: p.sig, rows: p.rows });
        }
        this.cache[tag] = next;
        this.profiles[tag] = profile;
        return true;
    }
    toggleProfile() {
        const sequence = ['S', 'D', 'M', 'W', null];
        const curIdx = sequence.indexOf(this.activeTag);
        const nextIdx = (curIdx + 1) % sequence.length;
        this.activeTag = sequence[nextIdx];
        return this.activeTag ?? 'OFF';
    }
    /** Set profil langsung dari panel Indikator (null = OFF). */
    setProfile(tag) {
        this.activeTag = ['S', 'D', 'M', 'W'].includes(tag ?? '') ? tag : null;
    }
    toggleNPOC() {
        this.showNPOC = !this.showNPOC;
        return this.showNPOC;
    }
    setNPOC(on) {
        this.showNPOC = on;
    }
    toggleNVA() {
        this.showNVA = !this.showNVA;
        return this.showNVA;
    }
    setNVA(on) {
        this.showNVA = on;
    }
    setLetters(on) {
        this.showLetters = on;
    }
    /**
     * Find screen X for a unix timestamp (in seconds) by interpolating barBuffer timestamps.
     */
    timeToScreenX(timeSec, bars, vp) {
        const n = bars.len;
        if (n === 0)
            return null;
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
            }
            else {
                hi = mid - 1;
            }
        }
        // lo is upper bound, hi is lower bound
        const idx0 = Math.max(0, hi);
        const idx1 = Math.min(n - 1, lo);
        if (idx0 === idx1)
            return vp.xToScreen(idx0);
        const t0 = times[idx0];
        const t1 = times[idx1];
        const frac = t1 > t0 ? (timeSec - t0) / (t1 - t0) : 0;
        const barPos = idx0 + frac;
        return vp.xToScreen(barPos);
    }
    draw(ctx, vp, bars) {
        if (!this.activeTag)
            return;
        // Data TPO bisa kosong (server belum siap / sumber tanpa TPO) — jangan crash.
        const profile = this.profiles[this.activeTag];
        if (!profile || !profile.periods || profile.periods.length === 0)
            return;
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
            if (xStart === null || xEnd === null)
                continue;
            // Skip if period is completely outside horizontal viewport
            if (Math.max(xStart, xEnd) < 0 || Math.min(xStart, xEnd) > chartW)
                continue;
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
            ctx.font = `600 ${Math.round(10 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
            ctx.fillStyle = '#9598A1';
            ctx.textAlign = 'left';
            ctx.fillText(`╎ ${period.name}`, xStart + 4 * dpr, 18 * dpr);
            ctx.restore();
            // 1.2 TPO Histogram Blocks
            // Lebar histogram TPO bisa diatur dari Panel Indikator → parameter TPO.
            const maxHistWidth = Math.min(Math.abs(xEnd - xStart) * settings.data.tpoWidth, 280 * dpr);
            this.drawHistogram(ctx, period, xStart, maxHistWidth, vp, dpr);
            // 1.3 POC, VAH, VAL Lines for this period
            this.drawPeriodLevels(ctx, period, xStart, xEnd, vp, dpr);
        }
        // 2. Perpanjangan nPOC / nVA: naked -> sampai tepi kanan; tersentuh -> berhenti di candle penyentuh.
        //    Digambar untuk semua periode, termasuk yang profilnya sudah di luar layar.
        const badges = [];
        for (let i = profile.periods.length - 1; i >= 0; i--) {
            const period = profile.periods[i];
            if (period.developing)
                continue; // levelnya masih bergerak
            const xFrom = this.timeToScreenX(period.end, bars, vp);
            if (xFrom === null)
                continue;
            const levels = [
                [this.showNPOC, 'nPOC', period.poc, period.touch_poc, '#FF1744'],
                [this.showNVA, 'nVAH', period.vah, period.touch_vah, '#FF9800'],
                [this.showNVA, 'nVAL', period.val, period.touch_val, '#29B6F6'],
            ];
            for (const [on, label, price, touch, color] of levels) {
                if (!on || price <= 0)
                    continue;
                const y = vp.yToScreen(price);
                if (y < 0 || y > chartH)
                    continue;
                if (touch === null) {
                    this.drawNakedLine(ctx, `${label} ${period.name}: ${price.toFixed(2)}`, xFrom, y, chartW, color, dpr, badges);
                }
                else {
                    const idx = this.touchBarIndex(bars, touch, profile.tf_min, price);
                    if (idx === null)
                        continue; // bar penyentuh lebih tua dari data yang dimuat
                    this.drawTouchedLine(ctx, xFrom, vp.xToScreen(idx), y, chartW, color, dpr);
                }
            }
        }
        ctx.restore();
    }
    drawHistogram(ctx, period, xStart, maxHistWidth, vp, dpr) {
        const rows = period.rows;
        if (!rows || rows.length === 0)
            return;
        let maxCount = 1;
        for (const r of rows) {
            if (r.count > maxCount)
                maxCount = r.count;
        }
        const tick = period.tick;
        const rowPx = Math.abs(vp.yToScreen(0) - vp.yToScreen(tick));
        const letters = this.showLetters && rowPx >= 11 * dpr;
        for (const row of rows) {
            const bottom = row.price - tick / 2;
            const top = row.price + (row.n - 0.5) * tick;
            if (top < vp.yMin || bottom > vp.yMax)
                continue;
            // Color based on status
            const fill = row.is_poc ? 'rgba(239, 83, 80, 0.60)' // POC highlight
                : row.in_va ? 'rgba(41, 98, 255, 0.42)' // Value Area
                    : 'rgba(120, 123, 134, 0.28)'; // Outside VA
            ctx.fillStyle = fill;
            const barWidth = (row.count / maxCount) * maxHistWidth;
            if (rowPx < 3 * dpr) {
                // baris terlalu tipis untuk dipisah: satu persegi untuk seluruh segmen
                const y0 = vp.yToScreen(top);
                ctx.fillRect(xStart, y0, barWidth, Math.max(1, vp.yToScreen(bottom) - y0));
                continue;
            }
            // hanya baris yang terlihat
            const k0 = Math.max(0, Math.floor((vp.yMin - row.price) / tick));
            const k1 = Math.min(row.n - 1, Math.ceil((vp.yMax - row.price) / tick));
            for (let k = k0; k <= k1; k++) {
                const y = vp.yToScreen(row.price + k * tick);
                ctx.fillRect(xStart, y - rowPx / 2, barWidth, Math.max(1 * dpr, rowPx - 0.5 * dpr));
                // Draw letters if zoomed in enough vertically
                if (letters && barWidth > 15 * dpr) {
                    ctx.font = `${Math.round(9 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
                    ctx.fillStyle = row.is_poc ? '#FF8A80' : row.in_va ? '#90CAF9' : '#B0BEC5';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(row.letters, xStart + 3 * dpr, y + 3 * dpr, barWidth - 4 * dpr);
                    ctx.fillStyle = fill;
                }
            }
        }
    }
    /** Indeks candle (pada timeframe chart) yang pertama menyentuh level. `touchTime` = waktu bar feed (tf_min)
     *  yang menyentuh; pada chart yang lebih halus dicari candle pertama di dalam rentang itu yang memuat harga. */
    touchBarIndex(bars, touchTime, feedTf, price) {
        const n = bars.len;
        if (n === 0)
            return null;
        // indeks terakhir dengan t <= touchTime
        let lo = 0;
        let hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (bars.t[mid] <= touchTime)
                lo = mid + 1;
            else
                hi = mid;
        }
        const base = lo - 1;
        const end = touchTime + feedTf * 60;
        for (let j = Math.max(0, base); j < n && bars.t[j] < end; j++) {
            if (bars.l[j] <= price && bars.h[j] >= price)
                return j;
        }
        return base >= 0 ? base : null;
    }
    drawPeriodLevels(ctx, period, xStart, xEnd, vp, dpr) {
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
    /** Level yang belum tersentuh: memanjang sampai tepi kanan dengan label (label tidak saling menimpa). */
    drawNakedLine(ctx, tag, xFrom, y, chartW, color, dpr, badges) {
        if (xFrom > chartW)
            return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, xFrom), y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        ctx.font = `bold ${Math.round(9.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
        const pad = 6 * dpr;
        const bw = ctx.measureText(tag).width + pad * 2;
        const bh = 16 * dpr;
        const box = { x0: chartW - bw - 4 * dpr, x1: chartW - 4 * dpr, y0: y - bh / 2, y1: y + bh / 2 };
        let clash;
        while ((clash = badges.find(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))) {
            box.x1 = clash.x0 - 3 * dpr;
            box.x0 = box.x1 - bw;
        }
        if (box.x0 >= 0) {
            badges.push(box);
            ctx.setLineDash([]);
            ctx.lineWidth = 1 * dpr;
            ctx.fillStyle = 'rgba(19, 23, 34, 0.90)';
            ctx.fillRect(box.x0, box.y0, bw, bh);
            ctx.strokeRect(box.x0, box.y0, bw, bh);
            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(tag, box.x0 + pad, y);
        }
        ctx.restore();
    }
    /** Level yang sudah tersentuh: berhenti tepat di candle penyentuh (ditandai garis tegak pendek). */
    drawTouchedLine(ctx, xFrom, xTouch, y, chartW, color, dpr) {
        if (xTouch < 0 || Math.min(xFrom, xTouch) > chartW)
            return;
        ctx.save();
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, Math.min(xFrom, xTouch)), y);
        ctx.lineTo(xTouch, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(xTouch, y - 4 * dpr);
        ctx.lineTo(xTouch, y + 4 * dpr);
        ctx.stroke();
        ctx.restore();
    }
    drawLevelBadge(ctx, label, price, x, y, color, dpr) {
        const text = `${label} ${price.toFixed(2)}`;
        ctx.font = `bold ${Math.round(9.5 * dpr)}px "Inter","Segoe UI",Roboto,Arial,sans-serif`;
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
