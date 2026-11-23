import type { Change, SceneObject, BoolMode, LightKind } from './scene';
import { PRESETS } from './materials';
import { SKY_PRESETS } from './sky';
import type { V3 } from './math';
import type { TerrainStyle } from './terrain';
import type { App } from './app';
import { Ctx, Child, h, svg, dragPad, num, slider, button, seg, color } from './widgets';
import { swatchStyle } from './lab';
import { buildTimeline } from './timeline';
import { clamp } from './math';

const ICONS: Record<string, string> = {
  terrain: '<path d="M2 19 8.5 7l3.5 6 3-4 7 10Z"/><path d="m8.5 7 1.2 4.2M15 9l.6 3.4"/>',
  ground: '<path d="M2 18 8 9h14l-6 9Z"/><path d="M5 13.5h14M11.5 9l-5 9M17 9l-5.5 9"/>',
  water: '<path d="M2 9c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0 4.5 2.4 6 .6M2 14c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0 4.5 2.4 6 .6M2 19c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0 4.5 2.4 6 .6"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.4"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/>',
  cone: '<path d="M12 3 5 18c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8Z"/><path d="M5 18c0-1.5 3.1-2.8 7-2.8s7 1.3 7 2.8"/>',
  radial: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3.5M12 18.500V22M2 12h3.500M18.500 12H22M5 5l2.500 2.500M16.500 16.500 19 19M19 5l-2.500 2.500M7.500 16.500 5 19"/>',
  spot: '<path d="M9 3h6l1 5H8Z"/><path d="M8 8 3 21h18L16 8"/>',
  parallel: '<path d="M4 4h16M7 8v12M12 8v12M17 8v12M7 20l-2-3M7 20l2-3M12 20l-2-3M12 20l2-3M17 20l-2-3M17 20l2-3"/>',
};

const BOOLS: BoolMode[] = ['neutral', 'positive', 'negative', 'intersect'];
const KINDS: LightKind[] = ['radial', 'spot', 'parallel'];

export function buildUI(app: App) {
  const { store } = app;
  const $ = (id: string) => document.getElementById(id)!;
  type Tab = 'create' | 'edit' | 'sky';
  let tab = 'create' as Tab;

  const group = (): Ctx => ({ changed: () => store.touch('scene'), commit: () => store.commit(), sync: [] });
  let pal = group();
  let panel = group();

  // ------------------------------------------------------------ top bar
  const tabsEl = $('tabs');
  const paletteEl = $('palette');
  const TABS: [Tab, string][] = [['create', 'Create'], ['edit', 'Edit'], ['sky', 'Sky & Fog']];

  function buildTabs() {
    tabsEl.replaceChildren(
      ...TABS.map(([id, label]) => button(label, () => { tab = id; buildTabs(); buildPalette(); }, 'tab' + (tab === id ? ' on' : ''))),
    );
  }

  function buildPalette() {
    pal = group();
    paletteEl.replaceChildren();
    if (tab === 'create') {
      const items: [string, string, () => void][] = [
        ['terrain', 'Terrain', () => app.add('terrain')],
        ['ground', 'Ground', () => app.add('plane')],
        ['water', 'Water', () => app.add('plane', 'water')],
        ['sphere', 'Sphere', () => app.add('sphere')],
        ['cube', 'Cube', () => app.add('cube')],
        ['cylinder', 'Cylinder', () => app.add('cylinder')],
        ['cone', 'Cone', () => app.add('cone')],
        ['radial', 'Radial light', () => app.add('light', 'radial')],
        ['spot', 'Spotlight', () => app.add('light', 'spot')],
        ['parallel', 'Parallel light', () => app.add('light', 'parallel')],
      ];
      for (const [icon, label, fn] of items) {
        const b = h('button', 'create-btn' + (icon === 'radial' ? ' gap' : ''), svg(ICONS[icon]), h('span', '', label));
        b.type = 'button';
        b.addEventListener('click', fn);
        paletteEl.append(b);
      }
    } else if (tab === 'edit') {
      const grid = h('div', 'swatches');
      for (const p of PRESETS) {
        const s = h('button', 'swatch');
        s.type = 'button';
        s.title = p.name;
        s.style.cssText = swatchStyle(p);
        s.addEventListener('click', () => {
          const o = store.sel;
          if (!o || o.type === 'light') return app.say('Select an object first, then pick a material.');
          o.mat = structuredClone(p);
          store.touch('scene');
          store.commit();
        });
        pal.sync.push(() => s.classList.toggle('on', !!store.sel && store.sel.type !== 'light' && store.sel.mat.name === p.name));
        grid.append(s);
      }
      const hint = h('div', 'pal-hint');
      pal.sync.push(() => {
        const o = store.sel;
        hint.textContent = o && o.type !== 'light' ? `Material for ${o.name}: ${o.mat.name}` : 'Select an object, then pick a material.';
      });
      paletteEl.append(
        h('div', 'pal-col wide', grid, hint),
        h('div', 'pal-col narrow',
          button('Edit material…', app.editMaterial, 'btn small'),
          button('Edit terrain…', app.editTerrain, 'btn small'),
          button('Duplicate', app.dup, 'btn small'),
          button('Delete', app.del, 'btn small'),
        ),
      );
    } else {
      const sky = () => store.scene.sky;
      const dot = h('div', 'sun-dot');
      const pad = h('div', 'sunpad', h('div', 'sun-ring'), dot);
      pad.title = 'Drag the sun. Centre is overhead, the rim is the horizon, past the rim is night.';
      const place = (e: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        const R = r.width / 2 / 1.18;
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const rr = Math.min(1.18, Math.hypot(dx, dy) / R);
        sky().sunEl = 90 * (1 - rr);
        if (rr > 0.01) sky().sunAz = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        store.touch('scene');
      };
      pad.addEventListener('pointerdown', place);
      dragPad(pad, (_a, _b, e) => place(e), () => store.commit());
      pal.sync.push(() => {
        const s = sky();
        const rr = clamp((1 - s.sunEl / 90) / 1.18, 0, 1);
        const a = (s.sunAz * Math.PI) / 180;
        dot.style.left = `${50 + Math.sin(a) * rr * 50}%`;
        dot.style.top = `${50 - Math.cos(a) * rr * 50}%`;
        dot.classList.toggle('moon', s.sunEl < -5);
      });
      const presets = h('div', 'pal-col narrow');
      for (const p of SKY_PRESETS) {
        presets.append(button(p.name, () => {
          store.scene.sky = structuredClone(p.sky);
          store.touch('scene');
          store.commit();
        }, 'btn small'));
      }
      paletteEl.append(
        pad,
        h('div', 'pal-col',
          slider(pal, 'Haze', () => sky().haze, (v) => (sky().haze = v)),
          slider(pal, 'Fog', () => sky().fog, (v) => (sky().fog = v)),
          slider(pal, 'Fog height', () => sky().fogHeight, (v) => (sky().fogHeight = v), 1, 40),
        ),
        h('div', 'pal-col',
          slider(pal, 'Cloud cover', () => sky().cloudCover, (v) => (sky().cloudCover = v)),
          slider(pal, 'Cloud height', () => sky().cloudHeight, (v) => (sky().cloudHeight = v), 150, 1500),
          slider(pal, 'Cloud size', () => sky().cloudScale, (v) => (sky().cloudScale = v), 0.3, 3),
        ),
        presets,
      );
    }
    for (const f of pal.sync) f();
  }

  $('docbtns').append(
    button('Undo', () => store.undo(), 'btn small', 'Ctrl+Z'),
    button('Random scene', app.randomize, 'btn small', 'Generate a new random scene (G)'),
    button('New scene', () => { if (confirm('Replace the current scene with the starter scene?')) store.reset(); }, 'btn small'),
    button('Save image', app.saveImage, 'btn small', 'Download the current render as a PNG'),
  );

  // ------------------------------------------------------------ left column
  const dots = $('dots');
  function buildDots() {
    dots.replaceChildren(
      h('span', 'cap', 'Views'),
      ...store.scene.views.map((v, i) => {
        const d = h('button', 'dot' + (v ? ' full' : ''));
        d.type = 'button';
        d.title = v ? 'Click to return to this view. Shift-click to clear it.' : 'Click to remember the current view.';
        d.addEventListener('click', (e) => {
          if (v && e.shiftKey) store.scene.views[i] = null;
          else if (v) { store.scene.camera = structuredClone(v); store.touch('camera'); }
          else store.scene.views[i] = structuredClone(store.scene.camera);
          store.commit(false);
          buildDots();
        });
        return d;
      }),
    );
  }

  const ball = h('div', 'trackball');
  ball.title = 'Drag to orbit the camera';
  dragPad(ball, (dx, dy) => app.orbit(dx, dy), app.camDone);
  const panPad = h('div', 'pad pan', svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'));
  panPad.title = 'Drag to slide the camera across the ground';
  dragPad(panPad, (dx, dy) => app.pan(dx, dy), app.camDone);
  const liftPad = h('div', 'pad', svg('<path d="M12 3v18M12 3 8 7M12 3l4 4M12 21l-4-4M12 21l4-4"/>'));
  liftPad.title = 'Drag up or down to raise or lower the camera';
  dragPad(liftPad, (_dx, dy) => app.lift(dy), app.camDone);
  const zoomPad = h('div', 'pad', svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 8v5M8 10.5h5"/>'));
  zoomPad.title = 'Drag up or down to zoom';
  dragPad(zoomPad, (_dx, dy) => app.zoom(dy), app.camDone);
  $('camctl').append(ball, h('div', 'pads', panPad, liftPad, zoomPad));

  const renderBtn = button('', () => app.setMode(app.mode() === 'render' ? 'wire' : 'render'), 'render-btn', 'R');
  const progFill = h('div', 'prog-fill');
  $('renderctl').append(renderBtn, h('div', 'prog', progFill));

  // ------------------------------------------------------------ right panel
  const right = $('right');

  function vec(label: string, get: () => V3, step: number, labels = ['X', 'Y', 'Z'], min = -1e6) {
    return h('div', 'field',
      h('div', 'cap', label),
      h('div', 'row3', ...[0, 1, 2].map((k) => num(panel, labels[k], () => get()[k], (x) => (get()[k] = x), { step, min }))),
    );
  }

  function iconFor(o: SceneObject): string {
    if (o.type === 'plane') return o.mat.transp > 0.3 ? 'water' : 'ground';
    if (o.type === 'light') return o.light?.kind ?? 'radial';
    return o.type;
  }

  function buildPanel() {
    panel = group();
    // Read the selection afresh each time: undo replaces the scene's objects.
    const cur = () => store.sel!;
    const o = store.sel;
    const list = h('div', 'objlist');
    for (const ob of store.scene.objects) {
      const row = h('button', 'objrow' + (ob.id === store.selected ? ' on' : ''), svg(ICONS[iconFor(ob)]), h('span', '', ob.name));
      row.type = 'button';
      row.addEventListener('click', () => store.select(ob.id));
      list.append(row);
    }
    const kids: Child[] = [h('div', 'cap head', 'Objects'), list];
    if (o) {
      const name = h('input', 'name');
      name.value = o.name;
      name.addEventListener('change', () => { cur().name = name.value || cur().name; store.touch('structure'); store.commit(); });
      name.addEventListener('keydown', (e) => e.stopPropagation());
      kids.push(h('div', 'cap head', 'Attributes'), name);
      if (o.type === 'plane') {
        kids.push(h('div', 'field', h('div', 'cap', 'Height'), num(panel, 'Y', () => cur().pos[1], (x) => (cur().pos[1] = x), { step: 0.1 })));
      } else if (o.type === 'light') {
        kids.push(vec('Position', () => cur().pos, 0.25));
        if (o.light?.kind !== 'radial') kids.push(vec('Aim', () => cur().rot, 0.5));
      } else {
        kids.push(vec('Position', () => cur().pos, 0.25), vec('Size', () => cur().size, 0.25, ['W', 'H', 'D'], 0.1), vec('Rotation', () => cur().rot, 0.5));
      }

      if (o.type === 'light' && o.light) {
        const L = () => cur().light!;
        kids.push(
          h('div', 'cap head', 'Light'),
          seg(panel, ['Radial', 'Spot', 'Parallel'], () => KINDS.indexOf(L().kind), (i) => { L().kind = KINDS[i]; queueMicrotask(buildPanel); }),
          h('div', 'matrow', color(panel, () => L().color, (c) => (L().color = c), 'Light colour'),
            h('div', 'grow', slider(panel, 'Brightness', () => L().power, (v) => (L().power = v), 0, 10))),
        );
        if (o.light.kind !== 'parallel') {
          kids.push(
            num(panel, 'Reach', () => L().range, (v) => (L().range = v), { step: 0.5, min: 1, max: 2000 }),
            h('div', 'field', h('div', 'cap', 'Falloff'), seg(panel, ['None', 'Linear', 'Squared'], () => L().falloff, (i) => (L().falloff = i))),
          );
        }
        if (o.light.kind === 'spot') {
          kids.push(
            slider(panel, 'Cone', () => L().cone, (v) => (L().cone = v), 3, 80),
            slider(panel, 'Soft edge', () => L().soft, (v) => (L().soft = v)),
          );
        }
        kids.push(seg(panel, ['Shadows off', 'Shadows on'], () => (L().shadows ? 1 : 0), (i) => (L().shadows = i === 1)));
        if (o.light.kind !== 'radial') kids.push(h('div', 'hint', 'With no rotation the light points straight down.'));
      }

      if (o.type === 'terrain' && o.terrain) {
        const tp = () => cur().terrain!;
        const regen = (fn: () => void) => () => {
          if (tp().map && !confirm('This terrain has been edited by hand. Replace it with a generated shape?')) return;
          fn();
          delete tp().map;
          store.touch('structure');
          store.commit();
        };
        const styles: [TerrainStyle, string][] = [['mountain', 'Peaks'], ['hills', 'Hills'], ['mesa', 'Mesa'], ['dunes', 'Dunes']];
        kids.push(
          h('div', 'cap head', 'Terrain'),
          button('Edit terrain…', app.editTerrain, 'btn'),
          h('div', 'row2', ...styles.map(([s, label]) =>
            button(label, regen(() => (tp().style = s)), 'btn small' + (!o.terrain!.map && o.terrain!.style === s ? ' on' : '')))),
          button('New shape', regen(() => (tp().seed = Math.floor(Math.random() * 1e6))), 'btn small'),
        );
        if (o.terrain.map) kids.push(h('div', 'hint', 'Edited by hand.'));
      }

      if (o.type !== 'light') {
        if (o.type !== 'terrain') {
          const hint = h('div', 'hint');
          panel.sync.push(() => {
            const c = cur();
            hint.textContent = c.bool === 'neutral' || !c.group
              ? 'Give objects the same group letter and a role to combine them.'
              : c.bool === 'negative' ? 'Cuts its shape out of the group.' : c.bool === 'intersect' ? 'Keeps only what lies inside it.' : 'Adds its shape to the group.';
          });
          kids.push(
            h('div', 'cap head', 'Boolean'),
            seg(panel, ['Off', 'Add', 'Cut', 'Clip'], () => BOOLS.indexOf(cur().bool), (i) => {
              cur().bool = BOOLS[i];
              if (i > 0 && !cur().group) cur().group = 1;
            }),
            h('div', 'matrow', h('span', 'cap', 'Group'), seg(panel, ['–', 'A', 'B', 'C', 'D'], () => cur().group, (i) => (cur().group = i), 'grow')),
            hint,
          );
        }
        const matName = h('div', 'matname');
        panel.sync.push(() => { matName.textContent = cur().mat.name; });
        const sw = h('div', 'swatch big');
        panel.sync.push(() => { sw.style.cssText = swatchStyle(cur().mat); });
        kids.push(
          h('div', 'cap head', 'Material'),
          h('div', 'matrow', sw, h('div', '', matName, button('Edit material…', app.editMaterial, 'btn small'))),
        );
      }
      kids.push(h('div', 'row2 tail', button('Duplicate', app.dup, 'btn small'), button('Delete', app.del, 'btn small')));
    } else {
      const cam = () => store.scene.camera;
      kids.push(
        h('div', 'cap head', 'Camera'),
        h('div', 'field', num({ ...panel, changed: () => store.touch('camera'), commit: () => store.commit(false) },
          'Field of view', () => cam().fov, (v) => (cam().fov = v), { step: 0.2, digits: 0, min: 15, max: 110 })),
        h('div', 'hint block',
          'Click an object to select it and drag to slide it across the ground. Hold Alt while dragging to raise or lower it. Drag empty space to orbit, Shift-drag to pan, scroll to zoom.'),
      );
    }
    right.replaceChildren(...(kids.filter(Boolean) as Node[]));
    for (const f of panel.sync) f();
  }

  // ------------------------------------------------------------ sync
  const statusEl = $('statustext');
  const timeline = buildTimeline(app, $('timeline'));

  function modeChanged() {
    const r = app.mode() === 'render';
    renderBtn.textContent = r ? 'Wireframe' : 'Render';
    renderBtn.classList.toggle('on', r);
    document.body.classList.toggle('rendering', r);
  }

  buildTabs();
  buildPalette();
  buildDots();
  buildPanel();
  modeChanged();

  return {
    sync(c: Change) {
      if (c === 'select' || c === 'structure') {
        buildPanel();
        if (c === 'structure') buildDots();
      } else {
        for (const f of panel.sync) f();
      }
      for (const f of pal.sync) f();
      timeline.sync();
    },
    status(text: string) {
      if (statusEl.textContent !== text) statusEl.textContent = text;
    },
    progress(f: number) {
      progFill.style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`;
    },
    modeChanged,
  };
}
