// Synthetic scenarios for the live-model pilot of the numbered record. No private content.
import { HELD_OUT } from './heldout.mjs';
// Every entry has `key`: a pattern that recognises its subject in a model's wording, so that IDs can be checked mechanically.
// A reply item whose text matches no key, or several, is reported as unclear and read by hand.

const objective = (title, key, progress = 'In progress.', eta = 'Unknown: not estimated yet') => ({ title, key, progress, eta });
const rule = (text, source, key, scope = 'This session') => ({ text, source, key, scope });

/** Checkpoint fidelity: a record of realistic size (25 rules, the median of saved reports; 8 objectives, one above their 90th percentile), then a conversation that changes it. */
export const RECORD = {
  objectives: [
    objective('Migrate the billing exporter to the new job queue', /billing exporter|exporter/i, 'Exporter builds against the new queue client.'),
    objective('Add rate limiting to the public search API', /rate[- ]limit/i, 'Design agreed; nothing implemented.'),
    objective('Fuzz the config parser and fix what it finds', /fuzz/i, 'Fuzzer harness written.'),
    objective('Write the runbook for database failover', /runbook|failover/i, 'Outline exists.'),
    objective('Build a Windows installer', /windows installer|installer/i, 'Not started.'),
    objective('Reduce the cold-start time of the CLI', /cold[- ]start/i, 'Profile taken: 40% is config loading.'),
    objective('Upgrade the logging library across services', /logging library|logging/i, 'Two of five services upgraded.'),
    objective('Audit third-party licences in the dependency tree', /licen[cs]e/i, 'Scanner chosen.'),
  ],
  rules: [
    rule('Ask before running any command that deletes files.', 'user', /delet/i),
    rule('Never push to the remote without being asked.', 'user', /\bpush/i),
    rule('Keep scratch notes in notes/session.md.', 'assistant', /scratch notes|session\.md/i),
    rule('Use British spelling in documentation.', 'user', /british/i),
    rule('Run the unit tests before saying a change is done.', 'user', /unit tests|run (?:the )?tests before/i),
    rule('Batch small related edits into one commit.', 'assistant', /batch/i),
    rule('Ask before running the linter, because it rewrites files.', 'user', /linter/i),
    rule('Do not touch the vendor directory.', 'user', /vendor/i),
    rule('Write commit messages in the imperative mood.', 'user', /imperative/i),
    rule('Re-read a file before editing it if another tool may have changed it.', 'assistant', /re-?read/i),
    rule('Report test counts, not just pass or fail.', 'user', /test counts|counts/i),
    rule('Keep answers short unless asked for detail.', 'user', /answers short|short answers|brief/i),
    rule('Use the staging database only.', 'user', /staging database/i),
    rule('Record every external request in the request log.', 'assistant', /request log/i),
    rule('No new dependencies without approval.', 'user', /new dependenc/i),
    rule('Prefer editing existing files over creating new ones.', 'user', /existing files/i),
    rule('Show a diff before applying a bulk rename.', 'user', /bulk rename|rename/i),
    rule('Use a separate worktree for each task.', 'assistant', /worktree/i),
    rule('Mention the ticket number in every commit.', 'user', /ticket/i),
    rule('Do not change public API signatures.', 'user', /signature/i),
    rule('Time-box investigations to thirty minutes, then report.', 'user', /time-?box|thirty minutes|30 minutes/i),
    rule('Name debug scripts with a timestamp prefix.', 'assistant', /debug scripts|timestamp prefix/i),
    rule('Explain a failing test before fixing it.', 'user', /failing test/i),
    rule('Keep generated files out of commits.', 'user', /generated files/i),
    rule('Use metric units in all measurements.', 'user', /metric/i),
  ],
};

/** What the conversation after the seeded checkpoint changes; indexes are positions in RECORD (0-based). */
export const CHECKPOINT_SCENARIO = {
  id: 'record',
  conversation: [
    { user: 'The config parser fuzzing is finished as far as I am concerned: you found and fixed the two crashes, and that is all I wanted.' },
    { assistant: 'Understood. The fuzzing run found two crashes in the config parser, an unterminated string and a deeply nested array; both are fixed and have regression tests. One caveat: the fuzzer ran for twenty minutes only.' },
    { user: 'Fine. A new task for later: add a dark-mode toggle to the settings page.' },
    { assistant: 'Noted. I will add a dark-mode toggle to the settings page after the current work.' },
    { user: 'Also, forget the Windows installer. We are not shipping on Windows this year.' },
    { assistant: 'Understood, I am dropping the Windows installer.' },
    { user: 'And you no longer need to ask me before running the linter: I changed its configuration so that it only reports.' },
    { assistant: 'Understood, I will run the linter without asking.' },
    { user: 'How is the exporter move going?' },
    { assistant: 'The exporter now writes to the new queue in staging; the retry policy is not ported yet. I expect about half a day more, provided the staging queue stays stable.' },
  ],
  completedObjective: 2,   // fuzzing: reported once as Complete, then left out
  cancelledObjective: 4,   // Windows installer: left out
  revokedRule: 6,          // linter: left out
  newObjective: /dark[- ]mode/i,
};

/**
 * Tool use: live turns; `expect` names what an attentive model would record, with the index of the turn it becomes
 * true in. `overRecording` recognises an objective made out of a plain question (undesired); `oneTurnRequest` one made
 * out of a small request answered in the same turn (reported, not judged).
 */
export const TOOL_SCENARIOS = [
  { id: 'build', heldOut: false,
    objectives: { a: /bazel|migrat/i, b: /onboarding/i, c: /checklist/i },
    rules: { length: /120 words|word/i, tables: /table/i },
    overRecording: /\b17\b|times|multipl|arithmetic|\b391\b/i, oneTurnRequest: null,
    turns: [
      'In this session I need three things from you: (a) a five-bullet outline for migrating our build from Make to Bazel, (b) a short onboarding note for new contributors, (c) a CI checklist. Start with (a) and give me only the five bullets.',
      'Two rules for the rest of this session: keep every answer under 120 words, and never use tables.',
      'The outline is all I need for (a): that one is done. Now write (b), the onboarding note.',
      'Good, (b) is done too. Skip (c): we no longer need the CI checklist. Instead, what is 17 times 23?',
    ],
    expect: { added: ['a', 'b', 'c'], addedBy: 0, rules: ['length', 'tables'], rulesBy: 1, complete: [['a', 2], ['b', 3]], retired: [['c', 3]] } },
  { id: 'report', heldOut: true,
    objectives: { a: /summary/i, b: /fact-?check|risk section/i },
    rules: { spelling: /british/i },
    overRecording: null, oneTurnRequest: /title/i,
    turns: [
      'Let us work on the quarterly report. I need the executive summary rewritten and the risk section fact-checked. Begin with the summary: give me three sentences about a company whose revenue grew 12% while costs grew 3%.',
      'By the way, always use British spelling with me today.',
      'Summary accepted. On to the risk section: list the three kinds of claim you would check first.',
      'Stop: legal will handle the fact-check, leave it. Can you instead propose a title for the report?',
    ],
    expect: { added: ['a', 'b'], addedBy: 0, rules: ['spelling'], rulesBy: 1, complete: [['a', 2]], retired: [['b', 3]] } },
];

/**
 * Batch 2 (guidance wording): tool sessions graded by `gradeRecord`. Each stated objective names the turn that states
 * it (`at`, 0-based) and what becomes of it: `['complete', turn]`, `['retired', turn]` or `['open']`. `questions`
 * recognises an entry made out of a plain question, `oneTurn` one made out of a small request that its own reply
 * answers completely; both are entries the record should not hold. `role` is `development` for scenarios the wording
 * was written against and `held-out` for those written by someone who had not seen the wording.
 * `build` and `report` have the turns of batch 1.
 */
const DEVELOPMENT_SCENARIOS = [
  { id: 'build', role: 'development', kind: 'work',
    objectives: { a: { key: /bazel|migrat/i, at: 0, fate: ['complete', 2] }, b: { key: /onboarding/i, at: 0, fate: ['complete', 3] }, c: { key: /checklist/i, at: 0, fate: ['retired', 3] } },
    rules: { length: { key: /120 words|word/i, at: 1 }, tables: { key: /table/i, at: 1 } },
    questions: /\b17\b|times|multipl|arithmetic|\b391\b/i, oneTurn: null,
    turns: TOOL_SCENARIOS[0].turns },
  { id: 'report', role: 'development', kind: 'work',
    objectives: { a: { key: /summary/i, at: 0, fate: ['complete', 2] }, b: { key: /fact-?check|risk/i, at: 0, fate: ['retired', 3] } },
    rules: { spelling: { key: /british/i, at: 1 } },
    questions: null, oneTurn: /title/i,
    turns: TOOL_SCENARIOS[1].turns },
  // Opposite error, nothing to record but one rule: questions and a small request, each answered by its own reply.
  { id: 'chat', role: 'development', kind: 'control',
    objectives: {},
    rules: { prose: { key: /prose|bullet|list/i, at: 2 } },
    questions: /mutex|semaphore|ipv6|bits/i, oneTurn: /name|photo|renam/i,
    turns: [
      'Quick one: what is the difference between a mutex and a semaphore? Two sentences.',
      'And how many bits are there in an IPv6 address?',
      'Please answer in plain prose from now on, no bullet lists.',
      'Thanks. Can you suggest a name for a small internal tool that renames photos by date?',
    ] },
  // Opposite error, one deliverable built over several turns: the parts are steps, not objectives.
  { id: 'single', role: 'development', kind: 'single',
    objectives: { plan: { key: /plan|postgres|migrat|upgrad/i, at: 0, fate: ['complete', 3] } },
    rules: { versions: { key: /version/i, at: 1 } },
    questions: null, oneTurn: null,
    turns: [
      'I need a plan for moving our Postgres 13 cluster to version 16; we will build it up over the next few messages. First: which three risks would you look at before anything else?',
      'One rule while we do this: give version numbers exactly, never "the latest".',
      'Fine. Next part of the plan: the cutover sequence, at most six steps.',
      'Good. Now put the whole plan together in one message, risks first; with that the plan is finished.',
    ] },
];
/**
 * The held-out scenarios are in `heldout.mjs`, byte for byte as their author wrote them (a model that had seen
 * neither the candidate wording nor any result; see the README). They add `examples`: titles an assistant might give
 * an entry, against which the keys are checked in `grade.test.mjs`.
 */
export const RECORD_SCENARIOS = [...DEVELOPMENT_SCENARIOS, ...HELD_OUT];
