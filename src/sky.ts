import { V3, lerp, clamp, smoothstep, norm } from './math';

export interface Sky {
  sunAz: number; // degrees, compass style
  sunEl: number; // degrees above the horizon, may go negative
  haze: number; // 0..1
  fog: number; // 0..1
  fogHeight: number; // world units
  cloudCover: number; // 0..1
  cloudHeight: number; // world units
  cloudScale: number; // 0.3..3
}

export const SKY_PRESETS: { name: string; sky: Sky }[] = [
  { name: 'Clear Day', sky: { sunAz: 140, sunEl: 50, haze: 0.25, fog: 0, fogHeight: 10, cloudCover: 0.3, cloudHeight: 500, cloudScale: 1 } },
  { name: 'Afternoon', sky: { sunAz: 215, sunEl: 27, haze: 0.35, fog: 0, fogHeight: 10, cloudCover: 0.45, cloudHeight: 450, cloudScale: 1 } },
  { name: 'Sunset', sky: { sunAz: 232, sunEl: 4, haze: 0.38, fog: 0.1, fogHeight: 8, cloudCover: 0.5, cloudHeight: 400, cloudScale: 1.2 } },
  { name: 'Misty Dawn', sky: { sunAz: 100, sunEl: 9, haze: 0.6, fog: 0.55, fogHeight: 7, cloudCover: 0.25, cloudHeight: 600, cloudScale: 0.8 } },
  { name: 'Moonlit', sky: { sunAz: 40, sunEl: -14, haze: 0.3, fog: 0.15, fogHeight: 6, cloudCover: 0.25, cloudHeight: 500, cloudScale: 1 } },
];

interface Key {
  el: number;
  zen: V3;
  hor: V3;
  sun: V3;
}

// Linear-light colours keyed on sun elevation.
const KEYS: Key[] = [
  { el: -14, zen: [0.004, 0.008, 0.026], hor: [0.02, 0.03, 0.07], sun: [0.16, 0.2, 0.32] },
  { el: -5, zen: [0.02, 0.035, 0.12], hor: [0.3, 0.14, 0.1], sun: [0.03, 0.03, 0.05] },
  { el: 0, zen: [0.07, 0.11, 0.32], hor: [0.95, 0.42, 0.16], sun: [0.9, 0.32, 0.1] },
  { el: 6, zen: [0.1, 0.19, 0.5], hor: [0.95, 0.58, 0.3], sun: [1.9, 0.95, 0.42] },
  { el: 18, zen: [0.07, 0.2, 0.6], hor: [0.62, 0.7, 0.82], sun: [2.5, 2.0, 1.45] },
  { el: 45, zen: [0.05, 0.17, 0.6], hor: [0.5, 0.68, 0.92], sun: [2.5, 2.35, 2.05] },
];

const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lum = (c: V3) => 0.21 * c[0] + 0.72 * c[1] + 0.07 * c[2];

export interface SkyUniforms {
  sunDir: V3;
  sunCol: V3;
  zenith: V3;
  horizon: V3;
  hazeCol: V3;
  skyAmb: V3;
  gndAmb: V3;
  cloudLit: V3;
  cloudDark: V3;
  atmo: [number, number, number, number];
  cloud: [number, number, number, number];
  sunP: [number, number, number, number];
}

export function dirFromAngles(az: number, el: number): V3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return norm([Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]);
}

export function skyUniforms(s: Sky): SkyUniforms {
  const el = clamp(s.sunEl, KEYS[0].el, KEYS[KEYS.length - 1].el);
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (el - a.el) / (b.el - a.el);
  let zen = mix3(a.zen, b.zen, t);
  let hor = mix3(a.hor, b.hor, t);
  const sun = mix3(a.sun, b.sun, t);

  // Heavy cloud cover greys the sky a little.
  const grey = smoothstep(0.55, 1, s.cloudCover) * 0.6;
  zen = mix3(zen, [lum(zen) * 1.6, lum(zen) * 1.6, lum(zen) * 1.7], grey);
  hor = mix3(hor, [lum(hor), lum(hor), lum(hor)], grey);

  const night = s.sunEl < -5;
  // Below the horizon the light source becomes a moon on the opposite side.
  const sunDir = night ? dirFromAngles(s.sunAz + 180, 38) : dirFromAngles(s.sunAz, Math.max(s.sunEl, 0.5));
  const hl = lum(hor);
  const hazeCol = mix3(hor, [hl, hl, hl * 1.05], 0.15);
  const skyAmb = mix3(zen, hor, 0.45).map((c) => c * 0.55 + 0.004) as V3;
  const gndAmb = mix3(hor, sun, 0.3).map((c) => c * 0.14 + 0.002) as V3;
  const sl = lum(sun);
  const cloudLit = mix3([sl * 0.45, sl * 0.45, sl * 0.45], sun, 0.45).map((c, k) => c * 0.5 + hor[k] * 0.35) as V3;
  const cloudDark = mix3(zen, hor, 0.5).map((c) => c * 0.55 + lum(zen) * 0.25) as V3;
  const stars = smoothstep(-3, -11, s.sunEl);

  return {
    sunDir,
    sunCol: sun,
    zenith: zen,
    horizon: hor,
    hazeCol,
    skyAmb,
    gndAmb,
    cloudLit,
    cloudDark,
    atmo: [s.haze * s.haze * 0.006, s.fog * s.fog * 0.06, Math.max(1, s.fogHeight), 0.12 + 0.6 * s.haze],
    cloud: [s.cloudCover, s.cloudHeight, (0.0026 * 400) / Math.max(100, s.cloudHeight) / Math.max(0.2, s.cloudScale) * 1.0, stars],
    sunP: [Math.cos(night ? 0.035 : 0.022), night ? 0.25 : 1, 0.02, 1.25],
  };
}
