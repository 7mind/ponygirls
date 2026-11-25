const MAX_COLS = 512;
const MAX_ROWS = 256;
const MAX_CELLS = 32768;
const MAX_EVENTS = 50000;
const MAX_MARKERS = 1000;
const MAX_RESIZES = 1000;
// The player schedules events with browser timers (signed 32-bit milliseconds).
const MAX_SECONDS = (2 ** 31 - 1) / 1000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function decodeLine(text, line) {
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid terminal recording on line ${line}.`); }
}
function dimensions(cols, rows, line) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error(`Invalid terminal size on line ${line}.`);
  }
  if (cols > MAX_COLS || rows > MAX_ROWS || cols * rows > MAX_CELLS) {
    throw new Error(`Terminal size on line ${line} exceeds the preview limit.`);
  }
}

/** Build the player's in-memory asciicast source from bounded UTF-8 text. The
 * player owns replay; the preview boundary owns which untrusted data it sees. */
export function parseAsciicast(text) {
  const end = text.indexOf('\n');
  const header = decodeLine(end === -1 ? text : text.slice(0, end), 1);
  if (header?.version !== 2 && header?.version !== 3) {
    throw new Error('Preview supports asciicast v2 and v3 recordings.');
  }
  const v3 = header.version === 3;
  const [width, height] = v3 ? [header.term?.cols, header.term?.rows] : [header.width, header.height];
  // Legacy recorders can report zero for unknown initial dimensions.
  const cols = width === 0 ? DEFAULT_COLS : width, rows = height === 0 ? DEFAULT_ROWS : height;
  dimensions(cols, rows, 1);
  const recording = v3 ? {version: 3, term: {cols, rows}} : {version: 2, width: cols, height: rows};
  const idle = header.idle_time_limit;
  if (Number.isFinite(idle) && idle >= 0 && idle <= MAX_SECONDS) recording.idle_time_limit = idle;

  const source = [recording];
  let time = 0, markers = 0, resizes = 0, hasOutput = false;
  for (let start = end === -1 ? text.length : end + 1, line = 2; start < text.length; line++) {
    const newline = text.indexOf('\n', start);
    const item = (newline === -1 ? text.slice(start) : text.slice(start, newline)).trim();
    start = newline === -1 ? text.length : newline + 1;
    if (!item || (v3 && item.startsWith('#'))) continue;
    if (source.length > MAX_EVENTS) throw new Error('Terminal recording exceeds the 50,000 event preview limit.');
    const event = decodeLine(item, line);
    if (!Array.isArray(event) || event.length !== 3 || typeof event[1] !== 'string' || !event[1]) {
      throw new Error(`Invalid terminal event on line ${line}.`);
    }
    const [seconds, code, data] = event;
    if (!Number.isFinite(seconds) || seconds < 0 || (!v3 && seconds < time)) {
      throw new Error(`Invalid terminal event time on line ${line}.`);
    }
    time = v3 ? time + seconds : seconds;
    if (time > MAX_SECONDS) throw new Error('Terminal recording duration exceeds the preview limit.');

    if (code === 'o' || code === 'r' || code === 'm') {
      if (typeof data !== 'string') throw new Error(`Invalid terminal event data on line ${line}.`);
      if (code === 'o') hasOutput ||= data.length > 0;
      else if (code === 'm' && ++markers > MAX_MARKERS) throw new Error('Terminal recording has too many markers to preview.');
      else if (code === 'r') {
        const size = /^(\d+)x(\d+)$/.exec(data);
        if (!size) throw new Error(`Invalid terminal size on line ${line}.`);
        dimensions(Number(size[1]), Number(size[2]), line);
        if (++resizes > MAX_RESIZES) throw new Error('Terminal recording has too many resizes to preview.');
      }
      source.push(event);
    } else {
      // Preserve the timing and trailing duration, but not recorded keyboard
      // input or the payloads of unknown event codes. The download is unchanged.
      source.push([seconds, 'x', '']);
    }
  }
  if (!hasOutput) throw new Error('Terminal recording contains no output to replay.');
  return source;
}
