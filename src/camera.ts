import { V3, add, sub, mul, cross, norm, dot } from './math';
import type { Camera } from './scene';

export interface Basis {
  pos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  tan: number;
}

export function basis(c: Camera): Basis {
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const off: V3 = [cp * Math.sin(c.yaw) * c.dist, sp * c.dist, cp * Math.cos(c.yaw) * c.dist];
  const pos = add(c.target, off);
  const fwd = norm(sub(c.target, pos));
  const right = norm(cross([0, 1, 0], fwd));
  const up = cross(fwd, right);
  return { pos, right, up, fwd, tan: Math.tan((c.fov * Math.PI) / 360) };
}

/** World-space ray through a pixel; x,y in canvas pixels with y down. */
export function screenRay(b: Basis, w: number, h: number, x: number, y: number): { o: V3; d: V3 } {
  const nx = (x / w) * 2 - 1;
  const ny = 1 - (y / h) * 2;
  const d = norm(add(add(mul(b.right, (nx * b.tan * w) / h), mul(b.up, ny * b.tan)), b.fwd));
  return { o: b.pos, d };
}

/** Camera-space coordinates of a world point: x right, y up, z forward. */
export function toCam(b: Basis, p: V3): V3 {
  const d = sub(p, b.pos);
  return [dot(d, b.right), dot(d, b.up), dot(d, b.fwd)];
}
