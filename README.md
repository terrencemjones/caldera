# Caldera

A landscape studio that runs in the browser. Build a scene from terrains, water, primitives and lights, give it a sky and procedural materials, then ray trace it on the GPU as a still image or an animated movie.

## Features

- **Ray-traced rendering** in a WebGL2 fragment shader, refined progressively, with a wireframe view for editing.
- **Terrains** generated as peaks, hills, mesas or dunes, plus an editor for painting heights (raise, lower, flatten, smooth) and applying filters such as erosion.
- **Primitives**: plane, sphere, cube, cylinder and cone, with boolean modes (positive, negative, intersect).
- **Lights**: radial, spot and parallel.
- **Sky**: sun position, haze, fog and clouds, with presets.
- **Material lab**: layered procedural textures built from noise sources, filters and colour ramps, optionally limited by altitude and slope.
- **Animation**: a keyframe timeline, with movies exported as MP4.
- **Random scenes**: one key generates a complete scene from hand-tuned recipes.
- **Undo**, and the scene is saved in the browser between sessions.

## Download

### Windows app

**[Download Caldera-Setup.cmd](https://github.com/terrencemjones/caldera/releases/latest/download/Caldera-Setup.cmd)** and double-click it.

Caldera installs in a few seconds and opens. After that it behaves like any other Windows app: it is in the Start menu and on the Desktop, runs in its own window, can be pinned to the taskbar, and can be removed from Settings > Apps.

- It needs Google Chrome or Microsoft Edge, which it uses to draw its window. Edge is already part of Windows 10 and 11.
- It installs for your user account only and does not ask for administrator rights. Everything goes in `%LOCALAPPDATA%\Caldera`.
- The installer is not code-signed, so your browser may ask you to confirm keeping the file, and Windows may show a "Windows protected your PC" prompt. Choose **More info**, then **Run anyway**.
- Uninstalling also deletes the scene and terrains saved inside the app.

### Any computer, no install

**[Download Caldera.html](https://github.com/terrencemjones/caldera/releases/latest/download/Caldera.html)**, then double-click it.

That one file is the whole application. It opens in your browser and runs from disk: no server and no internet connection needed. Use a recent Chrome or Edge for everything, including movie export.

## Building from source

Requires Node.js and npm.

```sh
npm install
npm run dev
```

Then open the address Vite prints.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run package` | Build, then pack everything into a single `dist/standalone.html` that runs from disk with no server |
| `npm run installer` | Package, then build the Windows installer `dist/Caldera-Setup.cmd` |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `G` | Generate a random scene |
| `R` | Toggle between render and wireframe |
| `Space` | Play or stop the animation |
| `Esc` | Back to wireframe, deselect, or cancel a movie render |
| `Del` | Delete the selected object |
| `Ctrl+D` | Duplicate the selected object |
| `Ctrl+Z` | Undo |

## Browser support

Rendering needs WebGL2 with floating-point render targets. Movie export needs the WebCodecs `VideoEncoder` API. Still images are saved as PNG.

## Project layout

| Path | Contents |
| --- | --- |
| `src/main.ts` | Application entry point and frame loop |
| `src/render/` | The ray tracer: GLSL shaders and the WebGL2 renderer |
| `src/scene.ts` | Scene model, undo history and persistence |
| `src/terrain.ts`, `src/terrainOps.ts`, `src/terrainEditor.ts` | Heightmap generation, filters and the terrain editor |
| `src/materials.ts`, `src/lab.ts` | Procedural materials and the material lab |
| `src/sky.ts` | Sky model and presets |
| `src/anim.ts`, `src/timeline.ts`, `src/video.ts` | Keyframes, the timeline and MP4 encoding |
| `src/random.ts` | Random scene recipes |
| `src/ui.ts`, `src/widgets.ts`, `src/wire.ts` | Interface, controls and the wireframe view |
| `scripts/package-windows.mjs` | Packs the build into one standalone HTML file |
| `scripts/build-installer.mjs` | Wraps the standalone file, icon and launcher into the Windows installer |
| `installer/` | The installer and uninstaller scripts, and the launcher that the installer compiles into `Caldera.exe` |
| `assets/` | The app icon |

## License

[MIT](LICENSE)
