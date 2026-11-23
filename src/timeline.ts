import type { App } from './app';
import { getState, setKey, removeKey, snapTime, targetName } from './anim';
import { Ctx, h, num, button, svg } from './widgets';
import { clamp } from './math';

const ICON = {
  rewind: '<path d="M6 5v14M19 5 9 12l10 7Z"/>',
  play: '<path d="M7 4v16l13-8Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  prev: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  key: '<path d="m12 4 7 8-7 8-7-8Z"/>',
  unkey: '<path d="m12 4 7 8-7 8-7-8ZM9 12h6"/>',
};

/** The animation strip along the bottom: transport, a scrub track with key marks, and timing. */
export function buildTimeline(app: App, root: HTMLElement) {
  const { store } = app;
  const anim = () => store.scene.anim;
  /** Which thing the key buttons act on when nothing is selected. */
  let fallback: 'camera' | 'sky' = 'camera';
  const target = () => (store.sel ? `obj:${store.sel.id}` : fallback);

  const ib = (icon: string, title: string, fn: () => void) => {
    const b = button('', fn, 'tl-btn', title);
    b.append(svg(icon));
    return b;
  };

  const playBtn = ib(ICON.play, 'Play or pause (Space)', () => (app.playing() ? app.stop() : app.play()));
  const marks = h('div', 'tl-marks');
  const head = h('div', 'tl-head');
  const track = h('div', 'tl-track', marks, head);
  const readout = h('span', 'tl-time');
  const who = button('', () => {
    if (store.sel) store.select(null);
    else fallback = fallback === 'camera' ? 'sky' : 'camera';
    sync();
  }, 'btn small tl-who', 'What the key buttons act on. Select an object to key it; click to switch between camera and sky.');
  const auto = button('Auto-key', () => {
    anim().auto = !anim().auto;
    store.commit(false);
    sync();
  }, 'btn small', 'When on, changing something at a time other than zero records a keyframe');

  const scrub = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    app.setTime(snapTime(anim(), clamp((e.clientX - r.left) / r.width, 0, 1) * anim().duration));
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    app.stop();
    track.setPointerCapture(e.pointerId);
    scrub(e);
    const up = () => {
      track.removeEventListener('pointermove', scrub);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      store.commit(false);
    };
    track.addEventListener('pointermove', scrub);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });

  const jump = (dir: number) => {
    const keys = anim().tracks[target()] ?? [];
    const t = anim().time, eps = 0.5 / anim().fps;
    const cand = dir > 0 ? keys.find((k) => k.t > t + eps) : [...keys].reverse().find((k) => k.t < t - eps);
    if (cand) {
      app.setTime(cand.t);
      store.commit(false);
    }
  };
  const addKey = () => {
    const s = getState(store.scene, target());
    if (!s) return;
    setKey(store.scene, target(), anim().time, s);
    store.rebase();
    store.commit();
    sync();
  };
  const delKey = () => {
    if (!removeKey(store.scene, target(), anim().time)) return app.say('There is no key at this time to remove.');
    app.setTime(anim().time);
    store.commit();
    sync();
  };

  const ctx: Ctx = {
    changed: () => sync(),
    commit: () => {
      anim().time = snapTime(anim(), anim().time);
      store.commit(false);
    },
    sync: [],
  };

  root.append(
    h('div', 'tl-group',
      ib(ICON.rewind, 'Back to the start', () => { app.stop(); app.setTime(0); store.commit(false); }),
      playBtn,
    ),
    h('div', 'tl-group',
      ib(ICON.prev, 'Previous key', () => jump(-1)),
      ib(ICON.key, 'Set a key here', addKey),
      ib(ICON.unkey, 'Remove the key here', delKey),
      ib(ICON.next, 'Next key', () => jump(1)),
    ),
    who,
    track,
    readout,
    h('div', 'tl-group',
      num(ctx, 'Length', () => anim().duration, (v) => (anim().duration = v), { step: 0.05, digits: 1, min: 0.5, max: 120 }),
      num(ctx, 'FPS', () => anim().fps, (v) => (anim().fps = Math.round(v)), { step: 0.1, digits: 0, min: 1, max: 60 }),
    ),
    auto,
    button('Render movie', app.renderMovie, 'btn small', 'Ray trace every frame and download an MP4'),
  );

  function sync() {
    const a = anim();
    const tg = target();
    head.style.left = `${(a.time / a.duration) * 100}%`;
    readout.textContent = `${a.time.toFixed(2)}s`;
    who.textContent = targetName(store.scene, tg);
    auto.classList.toggle('on', a.auto);
    playBtn.replaceChildren(svg(app.playing() ? ICON.pause : ICON.play));
    const kids: HTMLElement[] = [];
    const frames = Math.round(a.duration * a.fps);
    const every = Math.max(1, Math.ceil(frames / 60));
    for (let f = 0; f <= frames; f += every) {
      const tick = h('i', 'tl-tick' + (f % (every * 5) === 0 ? ' major' : ''));
      tick.style.left = `${(f / frames) * 100}%`;
      kids.push(tick);
    }
    for (const [name, keys] of Object.entries(a.tracks)) {
      for (const k of keys) {
        if (k.t > a.duration) continue;
        const m = h('i', 'tl-key' + (name === tg ? ' mine' : ''));
        m.style.left = `${(k.t / a.duration) * 100}%`;
        m.title = `${targetName(store.scene, name)} at ${k.t.toFixed(2)}s`;
        kids.push(m);
      }
    }
    marks.replaceChildren(...kids);
    for (const f of ctx.sync) f();
  }

  sync();
  return { sync };
}
