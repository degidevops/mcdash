export class PanZoom {
    el;
    yAxisEl;
    vp;
    onChange;
    onCrosshair;
    onCrosshairLeave;
    onAutoFollowChange;
    dragging = false;
    draggingY = false;
    lastX = 0;
    lastY = 0;
    lastDragY = 0;
    autoFollow = true;
    constructor(el, yAxisEl, vp, onChange, onCrosshair, onCrosshairLeave, onAutoFollowChange) {
        this.el = el;
        this.yAxisEl = yAxisEl;
        this.vp = vp;
        this.onChange = onChange;
        this.onCrosshair = onCrosshair;
        this.onCrosshairLeave = onCrosshairLeave;
        this.onAutoFollowChange = onAutoFollowChange;
        this.bindMouse();
        this.bindYAxis();
        this.bindTouch();
        this.bindWheel();
    }
    setAutoFollow(follow) {
        if (this.autoFollow !== follow) {
            this.autoFollow = follow;
            this.onAutoFollowChange?.(follow);
        }
    }
    setFollow(follow) {
        this.setAutoFollow(follow);
    }
    bindMouse() {
        this.el.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            this.dragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.el.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (this.dragging) {
                const dx = e.clientX - this.lastX;
                const dy = e.clientY - this.lastY;
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                this.vp.pan(dx, dy);
                this.vp.autoFitY = false;
                this.setFollow(false);
                this.onChange();
            }
            else if (!this.draggingY) {
                // crosshair
                const rect = this.el.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const dpr = window.devicePixelRatio || 1;
                if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
                    this.onCrosshair(x * dpr, y * dpr);
                }
            }
        });
        window.addEventListener('mouseup', () => {
            if (this.dragging) {
                this.dragging = false;
                this.el.style.cursor = 'crosshair';
            }
            if (this.draggingY) {
                this.draggingY = false;
                document.body.style.cursor = '';
            }
        });
        this.el.addEventListener('mouseleave', () => {
            if (!this.dragging && !this.draggingY)
                this.onCrosshairLeave();
        });
    }
    bindYAxis() {
        this.yAxisEl.style.cursor = 'ns-resize';
        this.yAxisEl.title = 'Drag: zoom skala harga | Double click: auto-fit';
        this.yAxisEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            this.draggingY = true;
            this.lastDragY = e.clientY;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!this.draggingY)
                return;
            const dy = e.clientY - this.lastDragY;
            this.lastDragY = e.clientY;
            // drag down expands, drag up compresses (or vice versa standard)
            const factor = 1 + dy * 0.008;
            const dpr = window.devicePixelRatio || 1;
            const rect = this.yAxisEl.getBoundingClientRect();
            const py = (e.clientY - rect.top) * dpr;
            this.vp.autoFitY = false;
            this.vp.zoomY(factor, py);
            this.onChange();
        });
        this.yAxisEl.addEventListener('dblclick', () => {
            this.vp.autoFitY = true;
            this.onChange();
        });
    }
    bindWheel() {
        this.el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.el.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const px = (e.clientX - rect.left) * dpr;
            // zoom X (number of visible bars)
            const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
            this.vp.zoom(factor, px);
            this.setFollow(false);
            this.onChange();
        }, { passive: false });
    }
    bindTouch() {
        let lastTouches = [];
        this.el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            lastTouches = Array.from(e.touches);
            const dpr = window.devicePixelRatio || 1;
            if (e.touches.length === 1) {
                this.onCrosshair(e.touches[0].clientX * dpr - this.el.getBoundingClientRect().left * dpr, e.touches[0].clientY * dpr - this.el.getBoundingClientRect().top * dpr);
            }
        }, { passive: false });
        this.el.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const cur = Array.from(e.touches);
            const dpr = window.devicePixelRatio || 1;
            if (cur.length === 1 && lastTouches.length === 1) {
                // pan
                const dx = cur[0].clientX - lastTouches[0].clientX;
                const dy = cur[0].clientY - lastTouches[0].clientY;
                this.vp.pan(dx, dy);
                this.vp.autoFitY = false;
                this.setFollow(false);
                this.onChange();
            }
            else if (cur.length === 2 && lastTouches.length === 2) {
                // pinch zoom
                const d0 = Math.hypot(lastTouches[1].clientX - lastTouches[0].clientX, lastTouches[1].clientY - lastTouches[0].clientY);
                const d1 = Math.hypot(cur[1].clientX - cur[0].clientX, cur[1].clientY - cur[0].clientY);
                if (d0 > 0) {
                    const factor = d0 / d1;
                    const midX = ((cur[0].clientX + cur[1].clientX) / 2 - this.el.getBoundingClientRect().left) * dpr;
                    this.vp.zoom(factor, midX);
                    this.setFollow(false);
                    this.onChange();
                }
            }
            lastTouches = cur;
        }, { passive: false });
        this.el.addEventListener('touchend', () => {
            lastTouches = [];
            this.onCrosshairLeave();
        });
    }
}
