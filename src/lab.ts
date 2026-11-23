import type { App } from './app';
import { Scene, SceneObject, makeObject, defaultScene } from './scene';
import { Material, Texture, TexComp, PRESETS, SOURCES, FILTERS, COMBINES, comp, preset, swatchColors } from './materials';
import { SKY_PRESETS } from './sky';
import { Ctx, h, num, slider, button, seg, choice, color, modal, css3 } from './widgets';
import type { V3 } from './math';

export function swatchStyle(m: Material): string {
  const [c1, c2] = swatchColors(m);
  const a = css3(c1, 1.15), b = css3(c2, 0.8);
  const gloss = m.reflect > 0.3 || m.transp > 0.3 ? 0.85 : m.specular > 0.3 ? 0.5 : 0.18;
  return `background: radial-gradient(circle at 34% 28%, rgba(255,255,255,${gloss}) 0, rgba(255,255,255,0) 26%), radial-gradient(circle at 40% 34%, ${a} 0, ${b} 78%, #05070a 100%);`;
}

const SHAPES = ['sphere', 'cube', 'terrain'] as const;

/** The materials editor: channel values on the left, the two texture slots on the right. */
export function openMaterialLab(app: App, target: SceneObject) {
  const mat: Material = structuredClone(target.mat);
  let shape = target.type === 'terrain' ? 2 : target.type === 'cube' ? 1 : 0;
  let slot: 'texA' | 'texB' = 'texA';

  // A little studio scene to show the material on.
  const studio: Scene = defaultScene();
  studio.objects = [];
  studio.sky = { ...structuredClone(SKY_PRESETS[1].sky), sunAz: 310, sunEl: 38, haze: 0.15, cloudCover: 0.35 };
  studio.camera = { target: [0, 9, 0], yaw: 0.5, pitch: 0.28, dist: 52, fov: 40 };
  const floor = makeObject(studio, 'plane');
  floor.mat = preset('Checker');
  floor.mat.reflect = 0;
  const subject = makeObject(studio, 'sphere');
  studio.objects.push(floor, subject);
  const stage = () => {
    const s = SHAPES[shape];
    subject.type = s;
    subject.mat = mat;
    if (s === 'terrain') {
      subject.pos = [0, 0, 0];
      subject.size = [44, 16, 44];
      subject.terrain = target.terrain ?? { seed: 11, style: 'mountain', rough: 0.5 };
      // Share the real object's id so its heightmap is reused.
      subject.id = target.terrain ? target.id : -1;
    } else {
      subject.pos = [0, 10, 0];
      subject.size = [20, 20, 20];
    }
    return studio;
  };

  const canvas = h('canvas', 'lab-preview');
  canvas.width = 300;
  canvas.height = 300;

  let pv: ReturnType<App['preview']> | null = null;
  const mk = (): Ctx => ({ changed: () => pv?.refresh(), commit: () => {}, sync: [] });
  const ctx = mk();
  // The channel and texture panels are rebuilt often, so each gets its own widget group.
  let cc = mk();
  let tc = mk();

  const win = modal('Materials', () => {
    target.mat = mat;
    app.store.touch('scene');
    app.store.commit();
  }, () => pv?.close());
  win.el.classList.add('lab');

  // ---- left: preview and presets
  const name = h('input', 'name');
  name.value = mat.name;
  name.addEventListener('input', () => (mat.name = name.value));
  name.addEventListener('keydown', (e) => e.stopPropagation());
  const presets = h('div', 'swatches');
  for (const p of PRESETS) {
    const s = h('button', 'swatch');
    s.type = 'button';
    s.title = p.name;
    s.style.cssText = swatchStyle(p);
    s.addEventListener('click', () => {
      Object.assign(mat, structuredClone(p));
      name.value = mat.name;
      buildChannels();
      buildTexture();
      pv?.refresh();
    });
    presets.append(s);
  }
  const left = h('div', 'lab-col lab-left',
    h('div', 'nano-frame', canvas),
    seg(ctx, ['Sphere', 'Cube', 'Terrain'], () => shape, (i) => (shape = i)),
    h('div', 'cap head', 'Name'), name,
    h('div', 'cap head', 'Start from'), presets,
  );

  // ---- middle: channels
  const mid = h('div', 'lab-col lab-mid');
  type SrcKey = 'colorSrc' | 'specSrc' | 'bumpSrc' | 'reflSrc' | 'transpSrc';
  const driver = (key: SrcKey) => {
    const el = seg(cc, ['–', 'A', 'B'], () => mat[key], (i) => (mat[key] = i), 'driver');
    el.title = 'Drive this channel with a plain value, texture A or texture B';
    return el;
  };
  const row = (label: string, control: Node, drv?: Node) =>
    h('div', 'chan', h('span', 'chan-label', label), h('div', 'chan-ctl', control), drv ?? h('span', 'driver'));
  type NumKey = 'ambient' | 'diffuse' | 'specular' | 'shininess' | 'metal' | 'bump' | 'reflect' | 'transp' | 'ior' | 'absorb';
  const sl = (key: NumKey, min = 0, max = 1) => slider(cc, '', () => mat[key], (v) => (mat[key] = v), min, max);

  function buildChannels() {
    cc = mk();
    mid.replaceChildren(
      h('div', 'cap head', 'Surface'),
      row('Colour', color(cc, () => mat.color, (c) => (mat.color = c)), driver('colorSrc')),
      row('Diffusion', sl('diffuse')),
      row('Ambience', sl('ambient')),
      row('Specularity', sl('specular'), driver('specSrc')),
      row('Highlight size', slider(cc, '', () => 1 - Math.log(mat.shininess / 5) / Math.log(100), (v) => (mat.shininess = 5 * Math.pow(100, 1 - v)))),
      row('Metallic', sl('metal')),
      row('Bump height', sl('bump', 0, 1.5), driver('bumpSrc')),
      h('div', 'cap head', 'Light through and off'),
      row('Reflection', sl('reflect'), driver('reflSrc')),
      row('Transparency', sl('transp'), driver('transpSrc')),
      row('Refraction', sl('ior', 1, 2.5)),
      row('Depth tint', sl('absorb', 0, 0.4)),
      h('div', 'hint block', 'A and B are the two textures on the right. A channel set to A or B takes its colour, or is scaled by its brightness, from that texture.'),
    );
  }

  // ---- right: texture editor
  const right = h('div', 'lab-col lab-right');

  function compCard(t: Texture, c: TexComp, i: number): HTMLElement {
    const n = (label: string, get: () => number, set: (v: number) => void, step: number, digits = 2, min = 0, max = 1e3) =>
      num(tc, label, get, set, { step, digits, min, max });
    const cols = h('div', 'ramp', ...[0, 1, 2].map((k) => color(tc, () => c.colors[k], (v: V3) => (c.colors[k] = v), ['Low', 'Middle', 'High'][k])));
    const card = h('div', 'card',
      h('div', 'card-head',
        h('span', 'cap', `Layer ${i + 1}`),
        t.comps.length > 1 ? button('Remove', () => { t.comps.splice(i, 1); buildTexture(); pv?.refresh(); }, 'btn small') : null,
      ),
      h('div', 'row2', choice(tc, SOURCES, () => c.source, (v) => (c.source = v)), cols),
      h('div', 'row3',
        n('Freq', () => c.freq, (v) => (c.freq = v), 0.005, 3, 0.001),
        n('Octaves', () => c.octaves, (v) => (c.octaves = Math.round(v)), 0.05, 0, 1, 7),
        n('Phase', () => c.phase, (v) => (c.phase = v), 0.01, 2, 0, 5),
      ),
      h('div', 'row3', ...[0, 1, 2].map((k) => n('XYZ'[k], () => c.stretch[k], (v) => (c.stretch[k] = v), 0.01, 2, 0, 20))),
      h('div', 'row3',
        choice(tc, FILTERS, () => c.filter, (v) => (c.filter = v)),
        n('a', () => c.fa, (v) => (c.fa = v), 0.02, 2, -20, 20),
        n('b', () => c.fb, (v) => (c.fb = v), 0.02, 2, -20, 20),
      ),
      h('div', 'row2', n('Phase freq', () => c.phaseFreq, (v) => (c.phaseFreq = v), 0.01, 2, 0.01, 50), i > 0 ? choice(tc, COMBINES, () => c.combine, (v) => (c.combine = v)) : null),
    );
    if (i > 0) {
      card.append(
        h('div', 'row2',
          n('Alt from', () => c.alt[0], (v) => (c.alt[0] = v), 0.005, 2, -1, 2),
          n('to', () => c.alt[1], (v) => (c.alt[1] = v), 0.005, 2, -1, 2),
        ),
        h('div', 'row2',
          n('Slope from', () => c.slope[0], (v) => (c.slope[0] = v), 0.005, 2, -1, 2),
          n('to', () => c.slope[1], (v) => (c.slope[1] = v), 0.005, 2, -1, 2),
        ),
      );
    }
    return card;
  }

  function buildTexture() {
    tc = mk();
    const t = mat[slot];
    const tabs = h('div', 'seg',
      button('Texture A', () => { slot = 'texA'; buildTexture(); }, 'btn small' + (slot === 'texA' ? ' on' : '')),
      button('Texture B', () => { slot = 'texB'; buildTexture(); }, 'btn small' + (slot === 'texB' ? ' on' : '')),
    );
    if (!t) {
      right.replaceChildren(tabs,
        h('div', 'hint block', 'This slot is empty.'),
        button('Add a texture', () => { mat[slot] = { scale: 1, comps: [comp({ freq: 0.3 })] }; buildTexture(); pv?.refresh(); }),
      );
    } else {
      right.replaceChildren(tabs,
        h('div', 'row2',
          num(tc, 'Scale', () => t.scale, (v) => (t.scale = v), { step: 0.01, digits: 2, min: 0.01, max: 100 }),
          button('Clear', () => { mat[slot] = null; buildTexture(); pv?.refresh(); }, 'btn small'),
        ),
        ...t.comps.map((c, i) => compCard(t, c, i)),
      );
      if (t.comps.length < 3) {
        right.append(button('Add a layer', () => { t.comps.push(comp({ freq: 0.5, combine: 1 })); buildTexture(); pv?.refresh(); }));
      }
    }
  }

  buildChannels();
  buildTexture();
  win.body.append(left, mid, right);
  pv = app.preview(canvas, stage);
}
