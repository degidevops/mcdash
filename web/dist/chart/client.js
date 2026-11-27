export class ChartClient {
    onBars;
    onTick;
    onStatus;
    onResync;
    ws = null;
    opened = false;
    tf = 60; // current timeframe in minutes
    source = 'main';
    onTpoCallback;
    onChartCallback;
    constructor(onBars, onTick, onStatus, onTpo, onChart, onResync) {
        this.onBars = onBars;
        this.onTick = onTick;
        this.onStatus = onStatus;
        this.onResync = onResync;
        this.onTpoCallback = onTpo;
        this.onChartCallback = onChart;
    }
    setTf(tf) { this.tf = tf; }
    setSource(s) { this.source = s; }
    /** Daftar pilihan sumber data dari server (label sudah berisi simbol). */
    async fetchInfo() {
        const resp = await fetch('/api/chart-info');
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    }
    async fetchBars(tf, count = 500, source, before) {
        const src = source ?? this.source;
        const extra = src && src !== 'main' ? `&source=${src}` : '';
        const older = before !== undefined ? `&before=${before}` : '';
        const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}${extra}${older}`);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return data.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    }
    async fetchTpo(tag, since) {
        const url = `/api/chart-tpo?tag=${tag}` + (since !== undefined ? `&since=${since}` : '');
        const resp = await fetch(url);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    }
    connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${location.host}/ws?chart=1`);
        this.ws = ws;
        ws.onopen = () => {
            this.onStatus(true);
            if (this.opened)
                this.onResync?.();
            this.opened = true;
        };
        ws.onclose = () => {
            this.onStatus(false);
            setTimeout(() => this.connect(), 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.k === 'tick' && typeof msg.p === 'number') {
                    this.onTick(msg.p, typeof msg.wall === 'number' ? msg.wall : 0);
                }
                else if (msg.k === 'chart' && typeof msg.src === 'string' && typeof msg.tf === 'number') {
                    const bars = (Array.isArray(msg.bars) ? msg.bars : []).map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
                    this.onChartCallback?.(msg.src, msg.tf, !!msg.full, bars);
                }
                else if (msg.k === 'tpo') {
                    this.onTpoCallback?.();
                }
                else if (msg.k === 'resync') {
                    this.onResync?.();
                }
            }
            catch { /* ignore */ }
        };
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
