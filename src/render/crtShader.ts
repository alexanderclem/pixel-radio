export interface CrtUniforms {
  scanlines: number
  aberration: number
  flicker: number
  curvature: number
  vignette: number
}

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_srcRes;
uniform vec2 u_outRes;
uniform float u_time;
uniform float u_scan;
uniform float u_aber;
uniform float u_flicker;
uniform float u_curve;
uniform float u_vig;
varying vec2 v_uv;

vec2 barrel(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  vec2 off = abs(c.yx) / vec2(5.5, 4.5);
  c += c * off * off * u_curve;
  return c * 0.5 + 0.5;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = barrel(v_uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Chromatic aberration grows toward the edges
  vec2 dir = uv - 0.5;
  vec2 ab = dir * u_aber * 0.006;
  vec3 col;
  col.r = texture2D(u_tex, uv + ab).r;
  col.g = texture2D(u_tex, uv).g;
  col.b = texture2D(u_tex, uv - ab).b;

  // Cheap glow: blend in a wider sample of the bright parts
  vec2 px = 1.0 / u_srcRes;
  vec3 halo = texture2D(u_tex, uv + vec2(px.x, 0.0)).rgb + texture2D(u_tex, uv - vec2(px.x, 0.0)).rgb
            + texture2D(u_tex, uv + vec2(0.0, px.y)).rgb + texture2D(u_tex, uv - vec2(0.0, px.y)).rgb;
  col += max(halo * 0.25 - 0.45, 0.0) * 0.35;

  // Scanlines locked to source rows + faint RGB aperture mask
  float line = 0.5 + 0.5 * cos(uv.y * u_srcRes.y * 6.28318);
  col *= 1.0 - u_scan * 0.25 * (1.0 - line);
  float mask = mod(gl_FragCoord.x, 3.0);
  vec3 aperture = mask < 1.0 ? vec3(1.08, 0.96, 0.96) : mask < 2.0 ? vec3(0.96, 1.08, 0.96) : vec3(0.96, 0.96, 1.08);
  col *= mix(vec3(1.0), aperture, u_scan * 0.35);

  // Slow rolling refresh bar and grain (no high-frequency strobe)
  float roll = smoothstep(0.0, 0.08, fract(uv.y * 0.6 - u_time * 0.12)) * (1.0 - smoothstep(0.08, 0.16, fract(uv.y * 0.6 - u_time * 0.12)));
  float grain = hash(uv * u_outRes + fract(u_time) * 100.0) - 0.5;
  col *= 1.0 + u_flicker * 0.02 * roll;
  col += u_flicker * grain * 0.02;

  // Vignette
  float vig = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  col *= mix(1.0, pow(clamp(vig, 0.0, 1.0), 0.28), u_vig);

  gl_FragColor = vec4(col, 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`CRT shader compile failed: ${log}`)
  }
  return shader
}

/** WebGL post-process that presents the 2D composite canvas through a CRT tube. */
export class CrtRenderer {
  private gl: WebGLRenderingContext
  private tex: WebGLTexture
  private loc: Record<string, WebGLUniformLocation | null>

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
    gl.useProgram(program)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.loc = Object.fromEntries(
      ['u_tex', 'u_srcRes', 'u_outRes', 'u_time', 'u_scan', 'u_aber', 'u_flicker', 'u_curve', 'u_vig'].map((n) => [
        n,
        gl.getUniformLocation(program, n),
      ]),
    )
    gl.uniform1i(this.loc.u_tex, 0)
  }

  static create(canvas: HTMLCanvasElement): CrtRenderer | null {
    try {
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false })
      return gl ? new CrtRenderer(gl) : null
    } catch (err) {
      console.warn(err)
      return null
    }
  }

  render(source: HTMLCanvasElement, u: CrtUniforms, time: number) {
    const { gl } = this
    const out = gl.canvas as HTMLCanvasElement
    gl.viewport(0, 0, out.width, out.height)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform2f(this.loc.u_srcRes, source.width, source.height)
    gl.uniform2f(this.loc.u_outRes, out.width, out.height)
    gl.uniform1f(this.loc.u_time, time)
    gl.uniform1f(this.loc.u_scan, u.scanlines)
    gl.uniform1f(this.loc.u_aber, u.aberration)
    gl.uniform1f(this.loc.u_flicker, u.flicker)
    gl.uniform1f(this.loc.u_curve, u.curvature)
    gl.uniform1f(this.loc.u_vig, u.vignette)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
