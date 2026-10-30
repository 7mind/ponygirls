import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const project = process.env.LIVE_CODEC_PROJECT;
if (typeof project !== 'string' || project.length === 0) throw new Error('LIVE_CODEC_PROJECT required');
const generated = pathToFileURL(resolve(project, 'generated/typescript') + '/').href;
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js') && typeof context.parentURL === 'string' && context.parentURL.startsWith(generated)) return next(specifier.slice(0, -3) + '.ts', context);
    throw error;
  }
} });
