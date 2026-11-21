// PanZoom — mouse / touch interaction handler for pan and zoom
import type { Viewport } from './viewport.js';
import { clamp } from './util.js';

export type PZCallback = () => void;

export class PanZoom {
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  autoFollow = true;

  constructor(
    private el: HTMLElement,
    private vp: Viewport,
    private onChange: PZCallback,
    private onCrosshair: (x: number, y: number) => void,
    private onCrosshairLeave: () => void,
  ) {
    this.bindMouse();
    this.bindTouch();
    this.bindWheel();
  }

  private bindMouse(): void {
    this.el.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.el.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.vp.pan(dx, dy);
        this.autoFollow = false;
        this.onChange();
      } else {
        // crosshair
        const rect = this.el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
          this.onCrosshair(x * devicePixelRatio, y * devicePixelRatio);
        }
      }
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
      this.el.style.cursor = 'crosshair';
    });
    this.el.addEventListener('mouseleave', () => {
      if (!this.dragging) this.onCrosshairLeave();
    });
  }

  private bindWheel(): void {
    this.el.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.el.getBoundingClientRect();
      const px = (e.clientX - rect.left) * devicePixelRatio;

      // zoom X (number of visible bars)
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      this.vp.zoom(factor, px);
      this.autoFollow = false;
      this.onChange();
    }, { passive: false });
  }

  private bindTouch(): void {
    let lastTouches: Touch[] = [];

    this.el.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      lastTouches = Array.from(e.touches);
      if (e.touches.length === 1) {
        this.onCrosshair(
          e.touches[0].clientX * devicePixelRatio - this.el.getBoundingClientRect().left * devicePixelRatio,
          e.touches[0].clientY * devicePixelRatio - this.el.getBoundingClientRect().top * devicePixelRatio,
        );
      }
    }, { passive: false });

    this.el.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      const cur = Array.from(e.touches);
      if (cur.length === 1 && lastTouches.length === 1) {
        // pan
        const dx = cur[0].clientX - lastTouches[0].clientX;
        const dy = cur[0].clientY - lastTouches[0].clientY;
        this.vp.pan(dx, dy);
        this.autoFollow = false;
        this.onChange();
      } else if (cur.length === 2 && lastTouches.length === 2) {
        // pinch zoom
        const d0 = Math.hypot(lastTouches[1].clientX - lastTouches[0].clientX, lastTouches[1].clientY - lastTouches[0].clientY);
        const d1 = Math.hypot(cur[1].clientX - cur[0].clientX, cur[1].clientY - cur[0].clientY);
        if (d0 > 0) {
          const factor = d0 / d1;
          const midX = ((cur[0].clientX + cur[1].clientX) / 2 - this.el.getBoundingClientRect().left) * devicePixelRatio;
          this.vp.zoom(factor, midX);
          this.autoFollow = false;
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
