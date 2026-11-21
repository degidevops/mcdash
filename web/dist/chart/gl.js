// WebGL2 context initialisation + shader helpers
const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;   // (barIndex, price)
layout(location=1) in vec4 a_color;
uniform vec4 u_view; // xMin, xMax, yMin, yMax
out vec4 v_color;
void main(){
  float nx = (a_pos.x - u_view.x) / (u_view.y - u_view.x) * 2.0 - 1.0;
  float ny = (a_pos.y - u_view.z) / (u_view.w - u_view.z) * 2.0 - 1.0;
  gl_Position = vec4(nx, ny, 0.0, 1.0);
  v_color = a_color;
}`;
const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main(){ fragColor = v_color; }`;
export function initGL(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl)
        throw new Error('WebGL2 not supported');
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Shader link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const uView = gl.getUniformLocation(prog, 'u_view');
    const buf = gl.createBuffer();
    return { gl, prog, buf, uView };
}
function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('Shader compile: ' + gl.getShaderInfoLog(s));
    }
    return s;
}
