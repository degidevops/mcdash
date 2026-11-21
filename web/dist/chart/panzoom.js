export class PanZoom {
    el;
    yAxisEl;
    xAxisEl;
    vp;
    onChange;
    onCrosshair;
    onCrosshairLeave;
    onAutoFollowChange;
    dragging = false;
    draggingX = false;
    draggingY = false;
    lastX = 0;
    lastY = 0;
    lastDragX = 0;
    lastDragY = 0;
    autoFollow = true;
    constructor(el, yAxisEl, xAxisEl, vp, onChange, onCrosshair, onCrosshairLeave, onAutoFollowChange) {
        this.el = el;
        this.yAxisEl = yAxisEl;
        this.xAxisEl = xAxisEl;
        this.vp = vp;
        this.onChange = onChange;
        this.onCrosshair = onCrosshair;
        this.onCrosshairLeave = onCrosshairLeave;
        this.onAutoFollowChange = onAutoFollowChange;
        this.bindMouse();
        this.bindXAxis();
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
            if (e.button !== 0 && e.button !== 1)
                return;
            this.dragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.el.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (this.dragging) {
                const dpr = window.devicePixelRatio || 1;
                const dx = (e.clientX - this.lastX) * dpr;
                const dy = (e.clientY - this.lastY) * dpr;
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                this.vp.pan(dx, dy);
                if (Math.abs(dy) > 2) {
                    this.vp.autoFitY = false;
                }
                if (Math.abs(dx) > 2) {
                    this.setFollow(false);
                }
                this.onChange();
            }
            else if (!this.draggingX && !this.draggingY) {
                // crosshair position
                const rect = this.el.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const dpr = window.devicePixelRatio || 1;
                if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
                    this.onCrosshair(x * dpr, y * dpr);
                }
                else {
                    this.onCrosshairLeave();
                }
            }
        });
        window.addEventListener('mouseup', () => {
            if (this.dragging) {
                this.dragging = false;
                this.el.style.cursor = 'crosshair';
            }
        });
        this.el.addEventListener('mouseleave', () => {
            if (!this.dragging && !this.draggingX && !this.draggingY) {
                this.onCrosshairLeave();
            }
        });
    }
    /** X-axis drag to zoom time scale (candle spacing) */
    bindXAxis() {
        this.xAxisEl.style.cursor = 'ew-resize';
        this.xAxisEl.title = 'Drag: zoom skala waktu | Double click: reset zoom';
        this.xAxisEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            this.draggingX = true;
            this.lastDragX = e.clientX;
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!this.draggingX)
                return;
            const dx = e.clientX - this.lastDragX;
            this.lastDragX = e.clientX;
            // Drag right = zoom in (wider spacing); drag left = zoom out (narrower)
            const factor = Math.exp(-dx * 0.006);
            const dpr = window.devicePixelRatio || 1;
            const rect = this.xAxisEl.getBoundingClientRect();
            const px = (e.clientX - rect.left) * dpr;
            this.vp.zoom(factor, px);
            this.setFollow(false);
            this.onChange();
        });
        window.addEventListener('mouseup', () => {
            if (this.draggingX) {
                this.draggingX = false;
                document.body.style.cursor = '';
            }
        });
        this.xAxisEl.addEventListener('dblclick', () => {
            // Reset visible range to standard ~120 bars
            const targetRange = 120;
            const currentRange = this.vp.xMax - this.vp.xMin;
            if (currentRange > 0) {
                const factor = targetRange / currentRange;
                this.vp.zoom(factor, this.vp.w * 0.9);
            }
            this.onChange();
        });
        // Touch support for X axis
        let lastTouchX = 0;
        this.xAxisEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                lastTouchX = e.touches[0].clientX;
                this.draggingX = true;
            }
        }, { passive: true });
        this.xAxisEl.addEventListener('touchmove', (e) => {
            if (!this.draggingX || e.touches.length !== 1)
                return;
            const dx = e.touches[0].clientX - lastTouchX;
            lastTouchX = e.touches[0].clientX;
            const factor = Math.exp(-dx * 0.008);
            this.vp.zoomX(factor);
            this.setFollow(false);
            this.onChange();
        }, { passive: true });
        this.xAxisEl.addEventListener('touchend', () => {
            this.draggingX = false;
        });
    }
    /** Y-axis drag to zoom price scale vertically */
    bindYAxis() {
        this.yAxisEl.style.cursor = 'ns-resize';
        this.yAxisEl.title = 'Drag: zoom skala harga | Double click: auto-fit harga';
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
            // Drag up = expand price range; drag down = compress price range
            const factor = Math.exp(-dy * 0.006);
            this.vp.autoFitY = false;
            this.vp.zoomYCenter(factor);
            this.onChange();
        });
        window.addEventListener('mouseup', () => {
            if (this.draggingY) {
                this.draggingY = false;
                document.body.style.cursor = '';
            }
        });
        this.yAxisEl.addEventListener('dblclick', () => {
            this.vp.autoFitY = true;
            this.onChange();
        });
        // Touch support for Y axis
        let lastTouchY = 0;
        this.yAxisEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                lastTouchY = e.touches[0].clientY;
                this.draggingY = true;
            }
        }, { passive: true });
        this.yAxisEl.addEventListener('touchmove', (e) => {
            if (!this.draggingY || e.touches.length !== 1)
                return;
            const dy = e.touches[0].clientY - lastTouchY;
            lastTouchY = e.touches[0].clientY;
            const factor = Math.exp(-dy * 0.008);
            this.vp.autoFitY = false;
            this.vp.zoomYCenter(factor);
            this.onChange();
        }, { passive: true });
        this.yAxisEl.addEventListener('touchend', () => {
            this.draggingY = false;
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
                const rect = this.el.getBoundingClientRect();
                this.onCrosshair((e.touches[0].clientX - rect.left) * dpr, (e.touches[0].clientY - rect.top) * dpr);
            }
        }, { passive: false });
        this.el.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const cur = Array.from(e.touches);
            const dpr = window.devicePixelRatio || 1;
            if (cur.length === 1 && lastTouches.length === 1) {
                // 1 finger = pan
                const dx = (cur[0].clientX - lastTouches[0].clientX) * dpr;
                const dy = (cur[0].clientY - lastTouches[0].clientY) * dpr;
                this.vp.pan(dx, dy);
                if (Math.abs(dy) > 2)
                    this.vp.autoFitY = false;
                if (Math.abs(dx) > 2)
                    this.setFollow(false);
                const rect = this.el.getBoundingClientRect();
                this.onCrosshair((cur[0].clientX - rect.left) * dpr, (cur[0].clientY - rect.top) * dpr);
                this.onChange();
            }
            else if (cur.length === 2 && lastTouches.length === 2) {
                // 2 fingers = pinch zoom X
                const d0 = Math.hypot(lastTouches[1].clientX - lastTouches[0].clientX, lastTouches[1].clientY - lastTouches[0].clientY);
                const d1 = Math.hypot(cur[1].clientX - cur[0].clientX, cur[1].clientY - cur[0].clientY);
                if (d0 > 0 && d1 > 0) {
                    const factor = d0 / d1;
                    const rect = this.el.getBoundingClientRect();
                    const midX = ((cur[0].clientX + cur[1].clientX) / 2 - rect.left) * dpr;
                    this.vp.zoom(factor, midX);
                    this.setFollow(false);
                    this.onChange();
                }
            }
            lastTouches = cur;
        }, { passive: false });
        this.el.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                lastTouches = [];
                this.onCrosshairLeave();
            }
            else {
                lastTouches = Array.from(e.touches);
            }
        });
    }
}
