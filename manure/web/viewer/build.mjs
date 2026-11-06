import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', {recursive:true, force:true});
await mkdir('dist');
await build({entryPoints: ['src/viewer.js', 'src/graphviz-worker.js'], outdir:'dist', bundle:true, format:'esm', minify:true, legalComments:'eof', target:'es2022'});
for (const file of ['index.html', 'styles.css']) await copyFile(file, `dist/${file}`);
for (const file of ['pdf.worker.min.mjs', 'pdf.renderer.min.mjs']) await copyFile(`node_modules/pdfjs-dist/build/${file}`, `dist/${file}`);
