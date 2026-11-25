import { build } from 'esbuild';
import { mkdir, copyFile, rm, readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const playerModule = import.meta.resolve('asciinema-player');
await rm('dist', {recursive:true, force:true});
await mkdir('dist');
await build({entryPoints: {
  viewer: 'src/viewer.js',
  'graphviz-worker': 'src/graphviz-worker.js',
  'asciinema-player': fileURLToPath(playerModule),
}, outdir:'dist', bundle:true, format:'esm', minify:true, legalComments:'eof', target:'es2022'});
for (const file of ['index.html', 'styles.css']) await copyFile(file, `dist/${file}`);
for (const file of ['pdf.worker.min.mjs', 'pdf.renderer.min.mjs']) await copyFile(`node_modules/pdfjs-dist/build/${file}`, `dist/${file}`);
await copyFile(new URL(import.meta.resolve('asciinema-player/dist/bundle/asciinema-player.css')), 'dist/asciinema-player.css');
// Keep the license with the bundled player that browsers receive.
const playerLicense = await readFile(new URL('../LICENSE', playerModule), 'utf8');
await appendFile('dist/asciinema-player.js', `\n/* Bundled asciinema-player\n${playerLicense.replaceAll('*/', '* /')}\n*/\n`);
