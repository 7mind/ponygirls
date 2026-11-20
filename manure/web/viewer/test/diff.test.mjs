import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, DIFF_FILE as F, DIFF_HUNK as H, DIFF_ADD as A, DIFF_DEL as D, DIFF_NOTE as N } from '../src/diff.js';
import { textLines } from '../src/tokens.js';

// Behavioral / Active / Blackbox / Atomic; unified-diff line classification.
const classify = text => diffLines(textLines(text));

test('git diff: headers, hunks, changes, context and totals', () => {
  const text = ['diff --git a/x.txt b/x.txt', 'index 3f1c2aa..9d04b71 100644', '--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,4 @@ heading', ' keep', '-old', '+new', '+more', ' tail',
    'diff --git a/y b/y', 'new file mode 100644', '--- /dev/null', '+++ b/y', '@@ -0,0 +1 @@', '+only', '\\ No newline at end of file', ''].join('\n');
  const result = classify(text);
  assert.deepEqual(result.classes, [F, F, F, F, H, '', D, A, A, '', F, F, F, F, H, A, N]);
  assert.deepEqual([result.files, result.additions, result.deletions], [2, 3, 1]);
});

test('lines inside a hunk are classified by the hunk counts, not by their look', () => {
  // The removed line is "-- a/x" and the added line is "++ b/x": they look like file headers.
  const result = classify('--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- a/x\n+++ b/x\n context\n--- a/z\n+++ b/z\n@@ -1 +1 @@\n-p\n+q\n');
  assert.deepEqual(result.classes, [F, F, H, D, A, '', F, F, H, D, A]);
  assert.deepEqual([result.files, result.additions, result.deletions], [2, 2, 2]);
});

test('an omitted hunk count is one line; an empty context line may have lost its space', () => {
  assert.deepEqual(classify('@@ -3 +3 @@\n-a\n+b\n').classes, [H, D, A]);
  assert.deepEqual(classify('@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n').classes, [H, '', '', D, A]);
});

test('renames and binary files count as files although they have no +++ line', () => {
  const result = classify('diff --git a/a.png b/b.png\nsimilarity index 100%\nrename from a.png\nrename to b.png\ndiff --git a/c.bin b/c.bin\nBinary files a/c.bin and b/c.bin differ\n');
  assert.deepEqual(result.classes, [F, F, F, F, F, F]);
  assert.equal(result.files, 2);
});

test('text around the diff stays unclassified', () => {
  const patch = 'From 1a2b3c Mon Sep 17 00:00:00 2001\nSubject: [PATCH] fix\n\n---\n x.txt | 2 +-\n\n--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n-- \n2.44.0\n';
  // "---" alone and the "-- " signature after the complete hunk are neither file headers nor deletions.
  assert.deepEqual(classify(patch).classes, ['', '', '', '', '', '', F, F, H, '', D, A, '', '']);
  assert.deepEqual(classify('just text\n+ not a diff\n- neither\n').classes, ['', '', '']);
});

test('a hunk shorter than its header ends at the first line that cannot belong to it; combined diffs are not classified', () => {
  assert.deepEqual(classify('@@ -1,5 +1,5 @@\n a\n-b\n+c\nplain\n-after\n').classes, [H, '', D, A, '', '']);
  assert.deepEqual(classify('@@ -1 +1,2 @@\n-a\n-b\n').classes, [H, D, '']);
  assert.deepEqual(classify('@@@ -1,2 -1,2 +1,3 @@@\n++both\n').classes, ['', '']);
});
