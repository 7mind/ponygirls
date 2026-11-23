const fs = require('node:fs');
const p = require('node:path');
const { workdir: allocatedCwd, root, checkoutAncestors, names, access, known, limit, ruleNames } = JSON.parse(fs.readFileSync(0, 'utf8'));
const workdir = process.cwd();
if (!p.isAbsolute(allocatedCwd) || fs.realpathSync.native(allocatedCwd) !== workdir) throw Error('Effective instruction directory changed: ' + allocatedCwd);
const files = [];
const seen = new Set(known);
const MAX_PATHS = 128;
let bytes = 0;
function inside(path, dir) {
  const rel = p.relative(dir, path);
  return !p.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + p.sep);
}
function enter(dir) {
  const components = dir.split(p.sep).filter(Boolean);
  if (components.length > MAX_PATHS) throw Error('Instruction path too deep');
  process.chdir(p.sep);
  for (const part of components) {
    const st = fs.lstatSync(part, { bigint: true });
    if (!st.isDirectory()) throw Error('Instruction directory is not a real directory: ' + dir);
    process.chdir(part);
    const here = fs.statSync('.', { bigint: true });
    if (st.ino !== here.ino || st.dev !== here.dev) throw Error('Instruction directory changed: ' + dir);
  }
}
function take(dir, name, required, scope) {
  const path = p.join(dir, name);
  if (!required && seen.has(path)) return true;
  let fd;
  try {
    const target = fs.realpathSync(path);
    if (!inside(target, scope)) {
      if (!required) return false;
      throw Error('Instruction link leaves the child working directory: ' + path);
    }
    if (seen.has(path)) return true;
    enter(p.dirname(target));
    fd = fs.openSync(p.basename(target), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  } catch (e) {
    if (!required && ['ENOENT', 'ELOOP', 'EACCES', 'ENOTDIR'].includes(e.code)) return false;
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() && !required) return false;
    if (!st.isFile() || bytes + st.size > limit || files.length >= MAX_PATHS) throw Error('Instruction files exceed limit or are not regular files: ' + path);
    const buf = Buffer.alloc(st.size + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n !== st.size) throw Error('Instruction file changed: ' + path);
    bytes += n;
    files.push({ path, content: buf.toString('utf8', 0, n).replace(/^\uFEFF/, '') });
    seen.add(path);
    return true;
  } finally { fs.closeSync(fd); }
}
function directory(spellings) {
  for (const name of ruleNames) {
    if (spellings.some(({ dir, scope }) => take(dir, name, false, scope))) return;
  }
}
function chain(first, last, includeFirst) {
  if (!inside(last, first)) throw Error('Instruction path outside project');
  const pieces = p.relative(first, last).split(p.sep).filter(Boolean);
  if (pieces.length > MAX_PATHS) throw Error('Instruction path too deep');
  let dir = first;
  if (includeFirst) directory([{ dir, scope: first }]);
  for (const part of pieces) { dir = p.join(dir, part); directory([{ dir, scope: first }]); }
}
function verifiedDirectory(path, expected) {
  try {
    const real = fs.realpathSync.native(path);
    const st = fs.statSync(real, { bigint: true });
    return st.isDirectory() && String(st.dev) === expected.dev && String(st.ino) === expected.ino && String(st.birthtimeNs) === expected.birth ? real : null;
  } catch { return null; }
}
if (checkoutAncestors?.length) {
  for (const { identity, paths } of checkoutAncestors.reverse()) {
    const spellings = paths.flatMap(({ path, scope }) => {
      const dir = verifiedDirectory(path, identity);
      return dir === null ? [] : [{ dir, scope: fs.realpathSync.native(scope) }];
    });
    directory(spellings);
  }
} else if (root !== null) chain(root, workdir, true);
if (access !== null) {
  const dir = verifiedDirectory(access.path, access);
  if (dir === access.path && inside(dir, workdir) && dir !== workdir) {
    chain(workdir, dir, false);
    if (verifiedDirectory(access.path, access) !== dir) files.length = 0;
  }
}
if (names.length > MAX_PATHS) throw Error('Too many named instruction files');
for (const name of names) {
  const path = p.resolve(workdir, name);
  if (!inside(path, workdir) || !ruleNames.includes(p.basename(name)) || name.split(p.sep).includes('..')) throw Error('Invalid child-local instruction name: ' + name);
  take(p.dirname(path), p.basename(path), true, workdir);
}
process.stdout.write(JSON.stringify(files));
