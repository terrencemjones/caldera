import { VERT, COPY_FRAG, TRACE_FRAG, MAXO, MAXL, MAXT } from './glsl';
import { Scene, SceneObject, objScale } from '../scene';
import { xform, xfDir, norm } from '../math';
import { skyUniforms, SkyUniforms } from '../sky';
import { HM, heightmap, terrainKey, TerrainParams } from '../terrain';
import { basis } from '../camera';
import type { Texture } from '../materials';

const TYPE_ID: Record<string, number> = { plane: 0, sphere: 1, cube: 2, cylinder: 3, cone: 4, terrain: 5 };
const MAX_LAYERS = 4;

export interface View {
  w: number;
  h: number;
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  low: WebGLTexture;
  lowFbo: WebGLFramebuffer;
  /** Block sizes of the coarse passes, largest first. */
  blocks: number[];
  /** Extra antialiasing samples after the first full-resolution pass. */
  aa: number;
  /** Terrain march step budget. */
  steps: number;
  stage: number;
  row: number;
  /** Rows rendered per step during full-resolution passes. */
  rows: number;
  done: boolean;
  /** The scene this view draws, flattened for the shader. */
  packed: Packed | null;
}

export interface Packed {
  count: number;
  types: Int32Array;
  inv: Float32Array;
  m: Float32Array[]; // ma..mg
  layers: { key: string; id: number; terrain: TerrainParams }[];
  tn: Int32Array;
  ts: Float32Array;
  t: Float32Array[]; // t0..t3, tc0..tc2
  ln: number;
  l: Float32Array[]; // lp, ld, lc, lq
  sky: SkyUniforms;
  camPos: number[];
  camRot: number[];
  tan: number;
  /** True if the scene needed more textures than the shader has slots for. */
  overflow: boolean;
}

function halton(i: number, b: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

/** Flatten a scene into the arrays the shader reads. */
export function pack(scene: Scene): Packed {
  const geo = scene.objects.filter((o) => o.type !== 'light').slice(0, MAXO);
  const lights = scene.objects.filter((o) => o.type === 'light' && o.light).slice(0, MAXL);
  const f4 = (n: number) => new Float32Array(4 * n);
  const p: Packed = {
    count: geo.length,
    types: new Int32Array(MAXO),
    inv: new Float32Array(16 * MAXO),
    m: [f4(MAXO), f4(MAXO), f4(MAXO), f4(MAXO), f4(MAXO), f4(MAXO), f4(MAXO)],
    layers: [],
    tn: new Int32Array(MAXT),
    ts: new Float32Array(2 * MAXT),
    t: [f4(MAXT * 3), f4(MAXT * 3), f4(MAXT * 3), f4(MAXT * 3), f4(MAXT * 3), f4(MAXT * 3), f4(MAXT * 3)],
    ln: lights.length,
    l: [f4(MAXL), f4(MAXL), f4(MAXL), f4(MAXL)],
    sky: skyUniforms(scene.sky),
    camPos: [],
    camRot: [],
    tan: 1,
    overflow: false,
  };

  // Identical textures share a slot.
  const slots: string[] = [];
  const slotFor = (t: Texture | null, used: boolean): number => {
    if (!t || !used || !t.comps.length) return -1;
    const key = JSON.stringify(t);
    let s = slots.indexOf(key);
    if (s >= 0) return s;
    if (slots.length >= MAXT) {
      p.overflow = true;
      return -1;
    }
    s = slots.length;
    slots.push(key);
    const comps = t.comps.slice(0, 3);
    p.tn[s] = comps.length;
    let maxF = 1e-3;
    comps.forEach((c, j) => {
      const k = (s * 3 + j) * 4;
      // Altitude and slope sources have no spatial frequency of their own.
      if (c.source !== 6 && c.source !== 7) maxF = Math.max(maxF, c.freq);
      p.t[0].set([c.source, c.octaves, c.freq, c.filter], k);
      p.t[1].set([c.fa, c.fb, c.phase, c.phaseFreq], k);
      p.t[2].set([c.stretch[0], c.stretch[1], c.stretch[2], c.combine], k);
      p.t[3].set([c.alt[0], c.alt[1], c.slope[0], c.slope[1]], k);
      p.t[4].set([...c.colors[0], 1], k);
      p.t[5].set([...c.colors[1], 1], k);
      p.t[6].set([...c.colors[2], 1], k);
    });
    p.ts.set([t.scale, t.scale * maxF], s * 2);
    return s;
  };

  // The first member of each boolean group does the work for all of it.
  const inGroup = (o: SceneObject) => o.group > 0 && o.bool !== 'neutral' && o.type !== 'terrain';
  const leaders = new Set<number>();
  const seen = new Set<number>();
  for (const o of geo) {
    if (inGroup(o) && !seen.has(o.group)) {
      seen.add(o.group);
      leaders.add(o.id);
    }
  }

  geo.forEach((o, i) => {
    const m = o.mat;
    const sc = objScale(o);
    p.types[i] = TYPE_ID[o.type];
    p.inv.set(xform(o.pos, o.rot, sc).inv, i * 16);
    let layer = 0;
    if (o.type === 'terrain' && o.terrain) {
      layer = Math.min(p.layers.length, MAX_LAYERS - 1);
      if (p.layers.length < MAX_LAYERS) p.layers.push({ key: o.id + ':' + terrainKey(o.terrain), id: o.id, terrain: o.terrain });
    }
    const usesA = [m.colorSrc, m.bumpSrc, m.specSrc, m.reflSrc, m.transpSrc].includes(1);
    const usesB = [m.colorSrc, m.bumpSrc, m.specSrc, m.reflSrc, m.transpSrc].includes(2);
    const sa = slotFor(m.texA, usesA), sb = slotFor(m.texB, usesB);
    const role = !inGroup(o) ? 0 : leaders.has(o.id) ? 1 : 2;
    const mode = o.bool === 'negative' ? 1 : o.bool === 'intersect' ? 2 : 0;
    const k = i * 4;
    p.m[0].set([m.color[0], m.color[1], m.color[2], m.colorSrc], k);
    p.m[1].set([m.ambient, m.diffuse, m.specular, m.shininess], k);
    p.m[2].set([m.reflect, m.transp, m.ior, m.bump], k);
    p.m[3].set([0, m.absorb, layer, m.metal], k);
    p.m[4].set([sa, sb, m.bumpSrc, m.specSrc], k);
    p.m[5].set([m.reflSrc, m.transpSrc, role, mode], k);
    p.m[6].set([sc[0], sc[1], sc[2], o.group], k);
  });

  lights.forEach((o, i) => {
    const L = o.light!;
    const kind = L.kind === 'radial' ? 0 : L.kind === 'spot' ? 1 : 2;
    const dir = norm(xfDir(xform(o.pos, o.rot, [1, 1, 1]).m, [0, -1, 0]));
    const outer = (Math.max(1, L.cone) * Math.PI) / 180;
    const inner = outer * (1 - Math.min(0.95, Math.max(0, L.soft)));
    const k = i * 4;
    p.l[0].set([o.pos[0], o.pos[1], o.pos[2], kind], k);
    p.l[1].set([dir[0], dir[1], dir[2], Math.cos(outer)], k);
    p.l[2].set([L.color[0] * L.power, L.color[1] * L.power, L.color[2] * L.power, Math.max(0.1, L.range)], k);
    p.l[3].set([Math.cos(inner) + 1e-4, L.falloff, L.shadows ? 1 : 0, 0], k);
  });

  const b = basis(scene.camera);
  p.camPos = b.pos;
  p.camRot = [...b.right, ...b.up, ...b.fwd];
  p.tan = b.tan;
  return p;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private trace: WebGLProgram;
  private copy: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private heightTex: WebGLTexture;
  private layerKeys: string[] = [];
  private colorFormat: number;
  private colorType: number;
  private pending: { p: WebGLProgram; shaders: WebGLShader[] }[] = [];
  private checked = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16;
    this.canvas.height = 16;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser does not support WebGL2, which the renderer needs.');
    this.gl = gl;

    const floatTargets = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.colorFormat = floatTargets ? gl.RGBA16F : gl.RGBA8;
    this.colorType = floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const linear = !!gl.getExtension('OES_texture_float_linear');

    this.trace = this.program(VERT, TRACE_FRAG(HM, linear));
    this.copy = this.program(VERT, COPY_FRAG);

    this.heightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.heightTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, HM, HM, MAX_LAYERS);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindVertexArray(gl.createVertexArray());
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const p = gl.createProgram()!;
    const shaders = [mk(gl.VERTEX_SHADER, vs), mk(gl.FRAGMENT_SHADER, fs)];
    for (const sh of shaders) gl.attachShader(p, sh);
    gl.linkProgram(p);
    // Status is checked later: asking now would block until the compile finishes.
    this.pending.push({ p, shaders });
    return p;
  }

  /** Throw if a shader failed to build. Blocks until the build is finished. */
  private check() {
    if (this.checked) return;
    const gl = this.gl;
    for (const { p, shaders } of this.pending) {
      if (gl.getProgramParameter(p, gl.LINK_STATUS)) continue;
      const logs = shaders.map((sh) => gl.getShaderInfoLog(sh)).filter(Boolean).join('\n');
      throw new Error('The renderer could not be built on this graphics card: ' + (logs || gl.getProgramInfoLog(p)));
    }
    this.pending = [];
    this.checked = true;
  }

  /**
   * Resolves once the shaders are built. The big tracing shader can take
   * several seconds the first time on some graphics drivers; where the
   * browser supports it, the wait happens off the main thread.
   */
  async ready(): Promise<void> {
    const gl = this.gl;
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    if (ext) {
      while (!this.pending.every(({ p }) => gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR))) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    this.check();
  }

  private loc(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = (p === this.trace ? 't:' : 'c:') + name;
    let l = this.locs.get(key);
    if (l === undefined) {
      l = this.gl.getUniformLocation(p, name);
      this.locs.set(key, l);
    }
    return l;
  }

  private target(w: number, h: number): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.colorFormat, w, h, 0, gl.RGBA, this.colorType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  createView(w: number, h: number, blocks: number[], aa: number, steps: number): View {
    const full = this.target(w, h);
    const minB = blocks.length ? blocks[blocks.length - 1] : 1;
    const low = this.target(Math.ceil(w / minB) + 1, Math.ceil(h / minB) + 1);
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    return {
      w, h,
      tex: full.tex, fbo: full.fbo,
      low: low.tex, lowFbo: low.fbo,
      blocks, aa, steps,
      stage: 0, row: 0, rows: Math.max(8, Math.ceil(h / 6)),
      done: false,
      packed: null,
    };
  }

  destroyView(v: View) {
    const gl = this.gl;
    gl.deleteTexture(v.tex);
    gl.deleteTexture(v.low);
    gl.deleteFramebuffer(v.fbo);
    gl.deleteFramebuffer(v.lowFbo);
  }

  /** Point a view at a scene and start its render over. */
  show(v: View, scene: Scene) {
    v.packed = pack(scene);
    v.stage = 0;
    v.row = 0;
    v.done = false;
  }

  private bindTrace(v: View) {
    const gl = this.gl;
    const p = v.packed!;
    const t = this.trace;
    const L = (n: string) => this.loc(t, n);
    gl.useProgram(t);

    // Make sure the heightmap layers hold this scene's terrains.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.heightTex);
    p.layers.forEach((ly, i) => {
      if (this.layerKeys[i] === ly.key) return;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, HM, HM, 1, gl.RED, gl.FLOAT, heightmap(ly.id, ly.terrain));
      this.layerKeys[i] = ly.key;
    });
    gl.uniform1i(L('uHeight'), 0);

    gl.uniform2f(L('uRes'), v.w, v.h);
    gl.uniform3fv(L('uCamPos'), p.camPos);
    gl.uniformMatrix3fv(L('uCamRot'), false, p.camRot);
    gl.uniform1f(L('uTanFov'), p.tan);
    gl.uniform1i(L('uCount'), p.count);
    gl.uniform1iv(L('uType[0]'), p.types);
    gl.uniformMatrix4fv(L('uInv[0]'), false, p.inv);
    ['uMA', 'uMB', 'uMC', 'uMD', 'uME', 'uMF', 'uMG'].forEach((n, i) => gl.uniform4fv(L(n + '[0]'), p.m[i]));
    gl.uniform1iv(L('uTN[0]'), p.tn);
    gl.uniform2fv(L('uTS[0]'), p.ts);
    ['uT0', 'uT1', 'uT2', 'uT3', 'uTC0', 'uTC1', 'uTC2'].forEach((n, i) => gl.uniform4fv(L(n + '[0]'), p.t[i]));
    gl.uniform1i(L('uLN'), p.ln);
    ['uLP', 'uLD', 'uLC', 'uLQ'].forEach((n, i) => gl.uniform4fv(L(n + '[0]'), p.l[i]));
    gl.uniform1i(L('uSteps'), v.steps);
    gl.uniform1i(L('uIter'), 10);
    const s = p.sky;
    gl.uniform3fv(L('uSunDir'), s.sunDir);
    gl.uniform3fv(L('uSunCol'), s.sunCol);
    gl.uniform3fv(L('uZenith'), s.zenith);
    gl.uniform3fv(L('uHorizon'), s.horizon);
    gl.uniform3fv(L('uHazeCol'), s.hazeCol);
    gl.uniform3fv(L('uSkyAmb'), s.skyAmb);
    gl.uniform3fv(L('uGndAmb'), s.gndAmb);
    gl.uniform3fv(L('uCloudLit'), s.cloudLit);
    gl.uniform3fv(L('uCloudDark'), s.cloudDark);
    gl.uniform4fv(L('uAtmo'), s.atmo);
    gl.uniform4fv(L('uCloud'), s.cloud);
    gl.uniform4fv(L('uSunP'), s.sunP);
  }

  /** Total number of stages: coarse passes, the first full pass, then AA samples. */
  stages(v: View): number {
    return v.blocks.length + 1 + v.aa;
  }

  /** Do one unit of work. Returns false when there was nothing left to do. */
  step(v: View): boolean {
    if (v.done || !v.packed) return false;
    this.check();
    const gl = this.gl;
    this.bindTrace(v);
    const L = (n: string) => this.loc(this.trace, n);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    if (v.stage < v.blocks.length) {
      const b = v.blocks[v.stage];
      const lw = Math.ceil(v.w / b), lh = Math.ceil(v.h / b);
      gl.bindFramebuffer(gl.FRAMEBUFFER, v.lowFbo);
      gl.viewport(0, 0, lw, lh);
      gl.uniform1f(L('uScale'), b);
      gl.uniform2f(L('uJitter'), 0, 0);
      gl.uniform1f(L('uPass'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo);
      gl.viewport(0, 0, v.w, v.h);
      gl.useProgram(this.copy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, v.low);
      gl.uniform1i(this.loc(this.copy, 'uTex'), 0);
      gl.uniform1f(this.loc(this.copy, 'uDiv'), b);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      v.stage++;
    } else {
      const k = v.stage - v.blocks.length;
      const rows = Math.min(v.rows, v.h - v.row);
      gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo);
      gl.viewport(0, 0, v.w, v.h);
      gl.enable(gl.SCISSOR_TEST);
      // Sweep from the top of the image downward.
      gl.scissor(0, v.h - v.row - rows, v.w, rows);
      if (k > 0) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, 1 / (k + 1));
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      }
      gl.uniform1f(L('uScale'), 1);
      gl.uniform2f(L('uJitter'), k === 0 ? 0 : halton(k, 2) - 0.5, k === 0 ? 0 : halton(k, 3) - 0.5);
      gl.uniform1f(L('uPass'), k);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      v.row += rows;
      if (v.row >= v.h) {
        v.row = 0;
        v.stage++;
        if (v.stage >= this.stages(v)) v.done = true;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /** Copy a view's current image onto a 2D canvas. */
  present(v: View, ctx: CanvasRenderingContext2D) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, v.w, v.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.copy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, v.tex);
    gl.uniform1i(this.loc(this.copy, 'uTex'), 0);
    gl.uniform1f(this.loc(this.copy, 'uDiv'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(this.canvas, 0, this.canvas.height - v.h, v.w, v.h, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
