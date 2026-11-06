import { instance } from '@viz-js/viz';
self.onmessage = async ({data}) => {
  try {
    if (typeof data !== 'string' || data.length > 50000) throw new Error('Diagram is too large.');
    const viz = await instance();
    const result = viz.renderString(data, {format:'svg', engine:'dot'});
    if (result.length > 8 * 1024 * 1024) throw new Error('Rendered diagram is too large.');
    self.postMessage({svg:result});
  } catch (error) { self.postMessage({error:String(error.message || error)}); }
};
