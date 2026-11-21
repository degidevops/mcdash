export class ChartClient {
    onBars;
    onTick;
    onStatus;
    ws = null;
    tf = 60; // current timeframe in minutes
    constructor(onBars, onTick, onStatus) {
        this.onBars = onBars;
        this.onTick = onTick;
        this.onStatus = onStatus;
    }
    setTf(tf) { this.tf = tf; }
    async fetchBars(tf, count = 500) {
        const resp = await fetch(`/api/chart-bars?tf=${tf}&count=${count}`);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return data.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
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
                // Future: handle bar updates from /ws/chart
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
