import type { V3 } from './math';

export const SOURCES = ['Fractal noise', 'Ridges', 'Turbulence', 'Cells', 'Waves', 'Checker', 'Altitude', 'Slope', 'Spots'];
export const FILTERS = ['None', 'Contrast', 'Smooth step', 'Sine bands', 'Quantize', 'Invert', 'Fold', 'Power'];
export const COMBINES = ['Layer over', 'Multiply', 'Add', 'Average', 'Maximum', 'Minimum', 'Blend by value'];

/**
 * One layer of a procedural texture: a source pattern, displaced by a phase
 * noise, reshaped by a filter, then mapped through a three-colour ramp.
 * Layers after the first are combined with the result so far, optionally
 * limited to a band of altitude and slope.
 */
export interface TexComp {
  source: number;
  freq: number;
  octaves: number;
  stretch: V3;
  phase: number;
  phaseFreq: number;
  filter: number;
  fa: number;
  fb: number;
  colors: [V3, V3, V3];
  alt: [number, number];
  slope: [number, number];
  combine: number;
}

export interface Texture {
  scale: number;
  comps: TexComp[];
}

/** Channel drivers: 0 = plain value, 1 = texture A, 2 = texture B. */
export interface Material {
  name: string;
  color: V3;
  colorSrc: number;
  ambient: number;
  diffuse: number;
  specular: number;
  specSrc: number;
  shininess: number;
  metal: number;
  bump: number;
  bumpSrc: number;
  reflect: number;
  reflSrc: number;
  transp: number;
  transpSrc: number;
  ior: number;
  absorb: number;
  texA: Texture | null;
  texB: Texture | null;
}

export function comp(o: Partial<TexComp> = {}): TexComp {
  return {
    source: 0,
    freq: 1,
    octaves: 4,
    stretch: [1, 1, 1],
    phase: 0,
    phaseFreq: 1,
    filter: 0,
    fa: 1,
    fb: 0,
    colors: [[0.05, 0.05, 0.05], [0.4, 0.4, 0.4], [0.9, 0.9, 0.9]],
    alt: [-1, 2],
    slope: [-1, 2],
    combine: 0,
    ...o,
  };
}

const tex = (scale: number, ...comps: TexComp[]): Texture => ({ scale, comps });

const base: Material = {
  name: 'Matte',
  color: [0.8, 0.8, 0.8],
  colorSrc: 0,
  ambient: 1,
  diffuse: 1,
  specular: 0,
  specSrc: 0,
  shininess: 40,
  metal: 0,
  bump: 0,
  bumpSrc: 0,
  reflect: 0,
  reflSrc: 0,
  transp: 0,
  transpSrc: 0,
  ior: 1.5,
  absorb: 0,
  texA: null,
  texB: null,
};

const m = (o: Partial<Material>): Material => ({ ...base, ...o });
const ripple = (freq: number) => tex(1, comp({ freq, octaves: 3 }));

export const PRESETS: Material[] = [
  m({
    name: 'Alpine', colorSrc: 1, bumpSrc: 1, bump: 0.5,
    texA: tex(1,
      comp({ freq: 0.35, octaves: 5, colors: [[0.2, 0.18, 0.16], [0.4, 0.35, 0.3], [0.5, 0.46, 0.4]] }),
      comp({ freq: 0.06, colors: [[0.1, 0.18, 0.05], [0.22, 0.35, 0.12], [0.32, 0.42, 0.16]], slope: [0.72, 2], alt: [-1, 0.42] }),
      comp({ freq: 0.2, octaves: 3, colors: [[0.8, 0.85, 0.94], [0.9, 0.93, 0.98], [0.96, 0.97, 1]], alt: [0.58, 2], slope: [0.55, 2] }),
    ),
  }),
  m({
    name: 'Red Strata', colorSrc: 1, bumpSrc: 1, bump: 0.35,
    texA: tex(1,
      comp({ source: 6, freq: 0.05, phase: 0.14, phaseFreq: 1, filter: 3, fa: 9, colors: [[0.72, 0.33, 0.16], [0.84, 0.5, 0.28], [0.93, 0.68, 0.42]] }),
      comp({ freq: 0.5, octaves: 3, colors: [[0.6, 0.6, 0.6], [0.85, 0.85, 0.85], [1, 1, 1]], combine: 1 }),
    ),
  }),
  m({
    name: 'Granite', colorSrc: 1, bumpSrc: 1, bump: 0.6, specular: 0.1,
    texA: tex(1,
      comp({ freq: 0.6, octaves: 5, filter: 2, fa: 0.3, fb: 0.7, colors: [[0.2, 0.2, 0.22], [0.36, 0.35, 0.34], [0.5, 0.48, 0.46]] }),
      comp({ source: 8, freq: 2.2, colors: [[0.1, 0.1, 0.1], [0.12, 0.11, 0.1], [0.15, 0.13, 0.12]], combine: 6 }),
    ),
  }),
  m({
    name: 'Sand', colorSrc: 1, bumpSrc: 1, bump: 0.1,
    texA: tex(1,
      comp({ freq: 0.15, colors: [[0.7, 0.57, 0.38], [0.78, 0.65, 0.44], [0.84, 0.72, 0.5]] }),
      comp({ source: 4, freq: 0.5, stretch: [1, 0, 0.12], phase: 0.9, phaseFreq: 0.25, colors: [[0.74, 0.62, 0.42], [0.77, 0.65, 0.44], [0.8, 0.68, 0.47]], combine: 3 }),
    ),
  }),
  m({
    name: 'Meadow', colorSrc: 1, bumpSrc: 1, bump: 0.2,
    texA: tex(1, comp({ freq: 0.08, colors: [[0.14, 0.3, 0.07], [0.2, 0.38, 0.1], [0.36, 0.42, 0.14]] })),
  }),
  m({
    name: 'Snow', colorSrc: 1, bumpSrc: 1, bump: 0.1, specular: 0.25, shininess: 20,
    texA: tex(1, comp({ freq: 0.2, colors: [[0.75, 0.8, 0.9], [0.86, 0.89, 0.95], [0.94, 0.95, 0.98]] })),
  }),
  m({
    name: 'Marble', colorSrc: 1, specular: 0.6, shininess: 90, reflect: 0.12,
    texA: tex(1, comp({ source: 4, freq: 0.07, stretch: [1.5, 0.7, 0.3], phase: 1.3, phaseFreq: 1.6, filter: 7, fa: 3, colors: [[0.9, 0.88, 0.84], [0.72, 0.71, 0.7], [0.25, 0.27, 0.3]] })),
  }),
  m({
    name: 'Checker', colorSrc: 1, specular: 0.4, shininess: 60, reflect: 0.18,
    texA: tex(1, comp({ source: 5, freq: 0.1, colors: [[0.9, 0.9, 0.88], [0.5, 0.5, 0.5], [0.08, 0.08, 0.1]] })),
  }),
  m({
    name: 'Wood', colorSrc: 1, bumpSrc: 1, bump: 0.08, specular: 0.3, shininess: 50,
    texA: tex(1, comp({ source: 4, freq: 0.35, stretch: [1, 0.06, 1], phase: 0.5, phaseFreq: 0.5, colors: [[0.3, 0.15, 0.06], [0.48, 0.27, 0.11], [0.62, 0.4, 0.19]] })),
  }),
  m({
    name: 'Rust', colorSrc: 1, bumpSrc: 1, bump: 0.5, specSrc: 1, specular: 0.5, shininess: 60,
    texA: tex(1,
      comp({ source: 3, freq: 0.45, phase: 0.5, phaseFreq: 1.5, colors: [[0.45, 0.16, 0.05], [0.55, 0.27, 0.1], [0.32, 0.3, 0.29]] }),
      comp({ freq: 1.2, colors: [[0.55, 0.55, 0.55], [0.8, 0.8, 0.8], [1, 1, 1]], combine: 1 }),
    ),
  }),
  m({ name: 'Chrome', color: [0.95, 0.96, 0.98], diffuse: 0.08, ambient: 0.1, specular: 1, shininess: 300, reflect: 0.92, metal: 1 }),
  m({ name: 'Gold', color: [1.0, 0.76, 0.3], diffuse: 0.2, ambient: 0.2, specular: 1, shininess: 160, reflect: 0.8, metal: 1 }),
  m({
    name: 'Hammered Copper', color: [0.95, 0.5, 0.3], diffuse: 0.2, ambient: 0.2, specular: 1, shininess: 120, reflect: 0.7, metal: 1, bumpSrc: 1, bump: 0.35,
    texA: tex(1, comp({ source: 3, freq: 0.5 })),
  }),
  m({ name: 'Glass', color: [0.9, 0.97, 0.95], diffuse: 0.05, ambient: 0.05, specular: 1, shininess: 400, reflect: 0.04, transp: 0.95, ior: 1.5, absorb: 0.02 }),
  m({
    name: 'Ice', color: [0.75, 0.9, 0.98], diffuse: 0.25, ambient: 0.3, specular: 1, shininess: 200, reflect: 0.05, transp: 0.75, ior: 1.31, absorb: 0.05, bumpSrc: 1, bump: 0.3,
    texA: tex(1, comp({ source: 1, freq: 0.3 })),
  }),
  m({ name: 'Red Plastic', color: [0.8, 0.08, 0.06], specular: 0.8, shininess: 120, reflect: 0.06 }),
  m({ name: 'Deep Water', color: [0.1, 0.32, 0.4], diffuse: 0.1, ambient: 0.1, specular: 1, shininess: 500, reflect: 0.03, transp: 0.92, ior: 1.33, bump: 0.5, bumpSrc: 1, absorb: 0.14, texA: ripple(0.28) }),
  m({ name: 'Lagoon', color: [0.35, 0.78, 0.72], diffuse: 0.06, ambient: 0.06, specular: 1, shininess: 500, reflect: 0.03, transp: 0.96, ior: 1.33, bump: 0.25, bumpSrc: 1, absorb: 0.07, texA: ripple(0.4) }),
  m({ name: 'Matte White', color: [0.85, 0.85, 0.83] }),
];

export function preset(name: string): Material {
  const p = PRESETS.find((x) => x.name === name) ?? PRESETS[0];
  return structuredClone(p);
}

/** Two representative colours for drawing a swatch of the material. */
export function swatchColors(mat: Material): [V3, V3] {
  const t = mat.colorSrc === 1 ? mat.texA : mat.colorSrc === 2 ? mat.texB : null;
  if (t && t.comps.length) return [t.comps[0].colors[2], t.comps[0].colors[0]];
  return [mat.color, [mat.color[0] * 0.3, mat.color[1] * 0.3, mat.color[2] * 0.3]];
}
