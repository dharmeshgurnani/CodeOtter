import { useEffect, useRef } from "react";

// Animated ordered-dither shader: slow-moving noise quantised through an 8x8 Bayer matrix into the app's palette
// (near-black, brand orange, amber) at a chunky pixel size. Static frame when the user prefers reduced motion.
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res; uniform float u_time; uniform float u_px;
vec3 hash3(vec2 p){ vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9))); return fract(sin(q) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash3(i).x, b = hash3(i + vec2(1.0, 0.0)).x, c = hash3(i + vec2(0.0, 1.0)).x, d = hash3(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
float bayer8(vec2 c){
  // 8x8 Bayer threshold built from the 2x2 recursion, values in [0,1)
  float v = 0.0; float s = 0.25; vec2 q = mod(c, 8.0);
  for (int i = 0; i < 3; i++) { vec2 b = mod(floor(q), 2.0); v += s * (b.x * 2.0 + b.y - 2.0 * b.x * b.y) ; q = floor(q / 2.0); s *= 0.25; }
  // the classic 8x8 pattern: fold a second axis for a less banded look
  vec2 m = mod(c, 8.0);
  float base = mod(m.x * 5.0 + m.y * 3.0 + m.x * m.y, 8.0) / 8.0;
  return fract(base * 0.5 + v);
}
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_px);
  vec2 uv = cell * u_px / u_res;
  float t = u_time * 0.05;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 2.2;
  float n = fbm(p + vec2(t, -t * 0.7) + 0.6 * fbm(p * 1.7 - t));
  float glow = smoothstep(0.85, 0.15, distance(uv, vec2(0.72, 0.35)));
  float v = n * 0.85 + glow * 0.35 - 0.12;
  float th = bayer8(cell);
  vec3 black = vec3(0.04, 0.04, 0.045);
  vec3 brand = vec3(0.76, 0.255, 0.047);
  vec3 amber = vec3(0.96, 0.62, 0.043);
  vec3 col = black;
  if (v > th * 0.9 + 0.25) col = brand;
  if (v > th * 0.6 + 0.62) col = amber;
  if (v > th * 0.35 + 0.86) col = vec3(0.99, 0.93, 0.80);
  gl_FragColor = vec4(col, 1.0);
}`;

export function DitherCanvas({ className = "", pixel = 3 }: { className?: string; pixel?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "u_res"), uTime = gl.getUniformLocation(prog, "u_time"), uPx = gl.getUniformLocation(prog, "u_px");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uPx, pixel * dpr);
    };
    const frame = () => {
      resize();
      gl.uniform1f(uTime, still ? 40 : (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!still) raf = requestAnimationFrame(frame);
    };
    const ro = new ResizeObserver(() => { if (still) frame(); });
    ro.observe(canvas);
    frame();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [pixel]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
