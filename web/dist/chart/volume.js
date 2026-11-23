import { settings, hexToRgb01 } from './settings.js';
const FLOATS_PER_VERT = 6;
const VERTS_PER_BAR = 6; // 2 triangles = 1 quad
export class VolumeRenderer {
    verts = new Float32Array(0);
    count = 0;
    /**
     * Volume bars are drawn in the same clip space as candles, but mapped to the bottom
     * portion of the canvas. We remap y: [0, maxVol] → [yMin, yMin + volRange].
     * volRange = (yMax-yMin) * volFrac / (1-volFrac) so that in screen pixels it
     * occupies the volFrac fraction at the bottom.
     */
    rebuild(bars, vp) {
        const iMin = Math.max(0, Math.floor(vp.xMin) - 1);
        const iMax = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);
        if (iMax < iMin) {
            this.count = 0;
            return;
        }
        const maxVol = bars.maxVolume(iMin, iMax) || 1;
        const n = iMax - iMin + 1;
        const need = n * VERTS_PER_BAR * FLOATS_PER_VERT;
        if (this.verts.length < need)
            this.verts = new Float32Array(need);
        // map volume Y into the same world coords:
        // screen bottom = yMin in clip, volume takes volFrac of total height
        // in world coords: volWorldRange covers volFrac of canvas
        const priceRange = vp.yMax - vp.yMin;
        const volWorldH = priceRange * vp.volFrac / (1 - vp.volFrac);
        const volBase = vp.yMin - volWorldH; // bottom of volume in world coords
        const bw = vp.barW;
        const halfBar = bw * settings.data.bodyWidth;
        const hbX = halfBar / vp.w * (vp.xMax - vp.xMin);
        const bullCol = hexToRgb01(settings.data.volumeUp, settings.data.volumeAlpha);
        const bearCol = hexToRgb01(settings.data.volumeDown, settings.data.volumeAlpha);
        let off = 0;
        for (let i = iMin; i <= iMax; i++) {
            const v = bars.v[i];
            const bull = bars.c[i] >= bars.o[i];
            const col = bull ? bullCol : bearCol;
            // Pusat bar volume = indeks bar i — sejajar persis dengan pusat candle.
            const cx = i;
            const top = volBase + (v / maxVol) * volWorldH;
            off = quad(this.verts, off, cx - hbX, volBase, cx + hbX, top, col);
        }
        this.count = off / FLOATS_PER_VERT;
    }
    draw(ctx, view) {
        if (this.count === 0)
            return;
        const { gl, prog, buf, uView } = ctx;
        gl.useProgram(prog);
        gl.uniform4fv(uView, view);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, this.count * FLOATS_PER_VERT), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_VERT * 4, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS_PER_VERT * 4, 8);
        gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
}
function quad(a, off, x0, y0, x1, y1, col) {
    const [r, g, b, al] = col;
    a[off++] = x0;
    a[off++] = y0;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    a[off++] = x1;
    a[off++] = y0;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    a[off++] = x1;
    a[off++] = y1;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    a[off++] = x0;
    a[off++] = y0;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    a[off++] = x1;
    a[off++] = y1;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    a[off++] = x0;
    a[off++] = y1;
    a[off++] = r;
    a[off++] = g;
    a[off++] = b;
    a[off++] = al;
    return off;
}
