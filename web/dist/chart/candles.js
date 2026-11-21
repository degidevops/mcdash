import { BULL, BEAR } from './util.js';
// Each vertex: (x, y, r, g, b, a) = 6 floats
// Each candle: body(6 verts) + upper wick(6) + lower wick(6) = 18 verts
const FLOATS_PER_VERT = 6;
const VERTS_PER_CANDLE = 18;
export class CandleRenderer {
    verts = new Float32Array(0);
    count = 0;
    rebuild(bars, vp) {
        const iMin = Math.max(0, Math.floor(vp.xMin) - 1);
        const iMax = Math.min(bars.len - 1, Math.ceil(vp.xMax) + 1);
        if (iMax < iMin) {
            this.count = 0;
            return;
        }
        const n = iMax - iMin + 1;
        const need = n * VERTS_PER_CANDLE * FLOATS_PER_VERT;
        if (this.verts.length < need)
            this.verts = new Float32Array(need);
        let off = 0;
        const bw = vp.barW;
        const halfBody = bw * 0.38;
        const halfWick = Math.max(bw * 0.06, 0.5) / vp.w * (vp.xMax - vp.xMin); // in world X
        for (let i = iMin; i <= iMax; i++) {
            const o = bars.o[i], h = bars.h[i], l = bars.l[i], c = bars.c[i];
            const bull = c >= o;
            const col = bull ? BULL : BEAR;
            const cx = i + 0.5; // center x in bar-index space
            // half-widths in world X coordinates
            const hbX = halfBody / vp.w * (vp.xMax - vp.xMin);
            const hwX = halfWick;
            const top = bull ? c : o;
            const bot = bull ? o : c;
            // body — 2 triangles
            off = quad(this.verts, off, cx - hbX, bot, cx + hbX, top, col);
            // upper wick
            off = quad(this.verts, off, cx - hwX, top, cx + hwX, h, col);
            // lower wick
            off = quad(this.verts, off, cx - hwX, l, cx + hwX, bot, col);
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
        // a_pos
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_VERT * 4, 0);
        // a_color
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS_PER_VERT * 4, 8);
        gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
}
/** Push 6 vertices (2 triangles) forming a rectangle */
function quad(a, off, x0, y0, x1, y1, col) {
    const [r, g, b, al] = col;
    // tri 1
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
    // tri 2
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
