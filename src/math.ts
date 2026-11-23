export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Row-major 3x3 rotation, R = Ry * Rx * Rz, angles in degrees. */
function rotation(rot: V3): number[] {
  const r = Math.PI / 180;
  const cx = Math.cos(rot[0] * r), sx = Math.sin(rot[0] * r);
  const cy = Math.cos(rot[1] * r), sy = Math.sin(rot[1] * r);
  const cz = Math.cos(rot[2] * r), sz = Math.sin(rot[2] * r);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Ry, mul3(Rx, Rz));
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}

/** Object transform and its inverse, both as column-major 4x4. */
export interface Xf {
  m: Float32Array;
  inv: Float32Array;
}

export function xform(pos: V3, rot: V3, s: V3): Xf {
  const R = rotation(rot);
  const m = new Float32Array(16);
  const inv = new Float32Array(16);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      m[j * 4 + i] = R[i * 3 + j] * s[j];
      inv[j * 4 + i] = R[j * 3 + i] / s[i];
    }
  }
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
  for (let i = 0; i < 3; i++) {
    inv[12 + i] = -(inv[i] * pos[0] + inv[4 + i] * pos[1] + inv[8 + i] * pos[2]);
  }
  inv[15] = 1;
  return { m, inv };
}

export function xfPoint(m: Float32Array, p: V3): V3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function xfDir(m: Float32Array, d: V3): V3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}
