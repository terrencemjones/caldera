// Packs the production build into one self-contained HTML file that runs from disk
// (no server needed). Usage: npm run package
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) =>
  `<style>${readFileSync(join(dist, href), 'utf8')}</style>`);
let scripts = '';
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  scripts += `<script type="module">${js}</script>`;
  return '';
});
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
html = html.replace('</body>', () => scripts + '</body>');
// Give the page its icon, so the app window shows it in the title bar and taskbar.
const icon = readFileSync(join('assets', 'icon-64.png')).toString('base64');
html = html.replace('</head>', () => `<link rel="icon" type="image/png" href="data:image/png;base64,${icon}"></head>`);
const out = process.argv[2] ?? join(dist, 'standalone.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)} KB)`);
