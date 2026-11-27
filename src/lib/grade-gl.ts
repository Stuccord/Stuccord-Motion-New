// Draws a picture (a video frame, an image, a cut-out canvas) through the
// export's grade, baked by the render worker into one 3D table
// (render-worker/luts.js bakeGradeTable: the correction, then the look's or
// the ready-made LUT), on the graphics card (WebGL2). The editor's preview
// then shows what the export will (to within a level or two of 255),
// instead of the rough CSS version of the look (looks.ts gradeCss), which
// stays as the fallback where WebGL2 isn't available.

/** A baked grade: SIZE^3 RGB (8-bit), red fastest (as a .cube file). */
export type GradeTable = { size: number; data: Uint8Array; key: string };

const VERTEX = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// The table holds the grade at grid points; sampling it at
// x * (n - 1) / n + 0.5 / n hits them exactly (linear in between). Colours
// come in unpremultiplied (a cut-out's soft edge keeps its own colour) and
// go out premultiplied, as the page composites them.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D picture;
uniform sampler3D grade;
uniform float size;
in vec2 uv;
out vec4 colour;
void main() {
  vec4 c = texture(picture, uv);
  vec3 at = clamp(c.rgb, 0.0, 1.0) * ((size - 1.0) / size) + 0.5 / size;
  vec3 g = texture(grade, at).rgb;
  colour = vec4(g * c.a, c.a);
}`;

let support: boolean | null = null;
/** Whether this browser can draw through a grade table (WebGL2). */
export function gradeGlSupported(): boolean {
  if (support != null) return support;
  try {
    support = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    support = false;
  }
  return support;
}

/** One canvas that draws pictures through a grade table. */
export class GradeRenderer {
  private gl: WebGL2RenderingContext;
  private pictureTex: WebGLTexture;
  private gradeTex: WebGLTexture;
  private sizeAt: WebGLUniformLocation | null;
  private tableKey = "";
  private tableSize = 0;

  /** Throws when the canvas can't do WebGL2 (callers fall back to CSS). */
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      // Kept, so the picture can be copied out (the blurred copy behind a clip).
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    this.pictureTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(gl.getUniformLocation(prog, "picture"), 0);
    this.gradeTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.gradeTex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.uniform1i(gl.getUniformLocation(prog, "grade"), 1);
    this.sizeAt = gl.getUniformLocation(prog, "size");
    // The picture's colours as they are (not premultiplied), top row first.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  /** Uses this table from now on (uploaded only when it changes). */
  setTable(t: GradeTable) {
    if (t.key === this.tableKey) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      t.size,
      t.size,
      t.size,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      t.data,
    );
    gl.uniform1f(this.sizeAt, t.size);
    this.tableKey = t.key;
    this.tableSize = t.size;
  }

  /** Draws `source` (w x h) through the table, the canvas sized to it. False when it couldn't. */
  draw(source: TexImageSource, w: number, h: number): boolean {
    if (!this.tableSize || !w || !h) return false;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false; // a frame that can't be read yet
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}

/** A table from the worker's answer (base64 bytes). */
export function gradeTableFrom(size: number, base64: string, key: string): GradeTable | null {
  try {
    const bin = atob(base64);
    if (bin.length !== size ** 3 * 3) return null;
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { size, data, key };
  } catch {
    return null;
  }
}
