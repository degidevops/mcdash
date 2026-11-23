export class ChartClient {
    onBars;
    onTick;
    onStatus;
    ws = null;
    tf = 60; // current timeframe in minutes
    source = 'main';
    onTpoCallback;
    onChartCallback;
    constructor(onBars, onTick, onStatus, onTpo, onChart) {
        this.onBars = onBars;
        this.onTick = onTick;
        this.onStatus = onStatus;
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
    async fetchBars(tf, count = 500, source) {
        const src = source ?? this.source;
        const extra = src && src !== 'main' ? `&source=${src}` : '';
        const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}${extra}`);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return data.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    }
    async fetchTpo(tag) {
        const url = tag ? `/api/chart-tpo?tag=${tag}` : '/api/chart-tpo';
        const resp = await fetch(url);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    }
    connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${location.host}/ws`);
        this.ws = ws;
        ws.onopen = () => this.onStatus(true);
        ws.onclose = () => {
            this.onStatus(false);
            setTimeout(() => this.connect(), 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.k === 'tick' && typeof msg.p === 'number') {
                    this.onTick(msg.p);
                }
                else if (msg.k === 'chart' && typeof msg.src === 'string' && typeof msg.tf === 'number') {
                    const bars = (Array.isArray(msg.bars) ? msg.bars : []).map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
                    this.onChartCallback?.(msg.src, msg.tf, !!msg.full, bars);
                }
                else if (msg.s || msg.k === 'meta') {
                    // Snapshot baru diterima dari engine -> perbarui TPO
                    if (this.onTpoCallback) {
                        this.fetchTpo().then(tpo => {
                            if (this.onTpoCallback)
                                this.onTpoCallback(tpo);
                        }).catch(() => { });
                    }
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
