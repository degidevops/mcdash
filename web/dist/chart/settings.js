// ChartSettings — pengaturan tampilan chart yang bisa diubah user via panel pengaturan
// (warna candle, lebar body, grid, countdown, tinggi/warna panel volume, lebar profil TPO,
// auto-history). Disimpan di localStorage agar bertahan antar sesi.
const STORAGE_KEY = 'mcdash.chart.settings';
const DEFAULTS = {
    candleUp: '#26A69A',
    candleDown: '#EF5350',
    bodyWidth: 0.38,
    showGrid: true,
    showCountdown: true,
    volumeHeight: 0.18,
    volumeUp: '#26A69A',
    volumeDown: '#EF5350',
    volumeAlpha: 0.25,
    tpoWidth: 0.70,
    autoHistory: true,
};
function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}
class ChartSettings {
    data = { ...DEFAULTS };
    constructor() {
        this.load();
    }
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw)
                return;
            const parsed = JSON.parse(raw);
            const d = this.data;
            if (isHexColor(parsed.candleUp))
                d.candleUp = parsed.candleUp;
            if (isHexColor(parsed.candleDown))
                d.candleDown = parsed.candleDown;
            if (typeof parsed.bodyWidth === 'number')
                d.bodyWidth = clamp(parsed.bodyWidth, 0.2, 0.5);
            if (typeof parsed.showGrid === 'boolean')
                d.showGrid = parsed.showGrid;
            if (typeof parsed.showCountdown === 'boolean')
                d.showCountdown = parsed.showCountdown;
            if (typeof parsed.volumeHeight === 'number')
                d.volumeHeight = clamp(parsed.volumeHeight, 0.08, 0.3);
            if (isHexColor(parsed.volumeUp))
                d.volumeUp = parsed.volumeUp;
            if (isHexColor(parsed.volumeDown))
                d.volumeDown = parsed.volumeDown;
            if (typeof parsed.volumeAlpha === 'number')
                d.volumeAlpha = clamp(parsed.volumeAlpha, 0.1, 0.6);
            if (typeof parsed.tpoWidth === 'number')
                d.tpoWidth = clamp(parsed.tpoWidth, 0.3, 0.9);
            if (typeof parsed.autoHistory === 'boolean')
                d.autoHistory = parsed.autoHistory;
        }
        catch { /* korup / tidak ada — pakai default */ }
    }
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        }
        catch { /* ignore */ }
    }
    /** Reset ke default (dipakai tombol "Kembalikan default" di panel pengaturan chart). */
    reset() {
        this.data = { ...DEFAULTS };
        this.save();
    }
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
/** Singleton — dibaca langsung oleh renderer (candles, volume, grid, axis, tpo). */
export const settings = new ChartSettings();
/** Konversi #RRGGBB → [r,g,b,a] dinormalisasi 0..1 untuk vertex WebGL. */
export function hexToRgb01(hex, alpha = 1.0) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    return [r, g, b, alpha];
}
