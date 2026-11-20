// Unified diff (diff -u, git diff, git format-patch) line classification.

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const FILE_HEADER = /^(?:diff |index |--- |\+\+\+ |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/;
const DEFAULT_HUNK_LINES = 1;

export const DIFF_FILE = 'diff-file';
export const DIFF_HUNK = 'diff-hunk';
export const DIFF_ADD = 'diff-add';
export const DIFF_DEL = 'diff-del';
export const DIFF_NOTE = 'diff-note';

/**
 * One class per line ('' for context and for text outside the diff) and the totals.
 * Lines inside a hunk are counted from its header, so a removed line `-- x` (shown as `--- x`) is a deletion,
 * not a file header. Combined (`@@@`) and context diffs are not classified.
 */
export function diffLines(lines) {
  let oldLeft = 0, newLeft = 0, gitFiles = 0, plainFiles = 0, additions = 0, deletions = 0;
  const classes = lines.map(line => {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('+') && newLeft > 0) { newLeft--; additions++; return DIFF_ADD; }
      if (line.startsWith('-') && oldLeft > 0) { oldLeft--; deletions++; return DIFF_DEL; }
      if (line.startsWith('\\')) return DIFF_NOTE;
      // Context; some tools strip the single space of an empty context line.
      if ((line.startsWith(' ') || line === '\n' || line === '\r\n' || line === '') && oldLeft > 0 && newLeft > 0) { oldLeft--; newLeft--; return ''; }
      oldLeft = newLeft = 0; // the hunk is shorter than its header says: classify this line as outside it
    }
    const hunk = line.match(HUNK);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? DEFAULT_HUNK_LINES : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? DEFAULT_HUNK_LINES : Number(hunk[2]);
      return DIFF_HUNK;
    }
    if (line.startsWith('\\')) return DIFF_NOTE;
    if (!FILE_HEADER.test(line)) return '';
    if (line.startsWith('diff ')) gitFiles++;
    if (line.startsWith('+++ ')) plainFiles++;
    return DIFF_FILE;
  });
  // `diff` command lines name every file, including renames and binary files that have no `+++` line.
  return { classes, files: gitFiles > 0 ? gitFiles : plainFiles, additions, deletions };
}
