import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js') && context.parentURL?.includes('/generated/typescript/')) return next(specifier.slice(0, -3) + '.ts', context);
    throw error;
  }
} });
