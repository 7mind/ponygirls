import { join } from 'node:path';
import { readJsonPreferences, writeJsonPreferences } from '@ponygirls/pi-settings';
import { CONFIG_DIR_NAME, type ExtensionContext } from '@earendil-works/pi-coding-agent';

export const QUESTIONS_FILE = 'cuckoo-questions.json';
export const MAX_QUESTIONS = 32;
export const MAX_QUESTION_CHARS = 2000;
const ID_ATTEMPTS = 8;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export type QuestionScope = 'global' | 'project';
export const QUESTION_SCOPES: readonly QuestionScope[] = ['global', 'project'];
export interface StandingQuestion { readonly id: string; readonly question: string }
/** A standing question as put to the model in one inquiry; saved with that checkpoint. */
export interface AskedQuestion extends StandingQuestion { readonly scope: QuestionScope }
export interface QuestionStore { readonly path: string; read(): readonly StandingQuestion[]; write(value: readonly StandingQuestion[]): void }
export type QuestionContext = Pick<ExtensionContext, 'cwd' | 'isProjectTrusted'>;
export interface QuestionSnapshot {
  /** Global questions, then trusted-project questions: the order they are asked in. */
  readonly effective: readonly AskedQuestion[];
  readonly projectTrusted: boolean;
  readonly paths: Readonly<Record<QuestionScope, string>>;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Cuckoo standing question object');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new Error(`Cuckoo standing question data must contain only ${fields.join(', ')}`);
}
function storedId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error('Invalid Cuckoo standing question id');
  return value;
}
function storedText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_QUESTION_CHARS || CONTROL.test(value)) {
    throw new Error(`Cuckoo standing question must be one nonempty line without control characters, at most ${MAX_QUESTION_CHARS} characters`);
  }
  return value;
}

/** Normalize operator input to the stored one-line form. */
export function questionText(value: string): string {
  return storedText(value.replace(/\s+/g, ' ').replace(new RegExp(CONTROL.source, 'g'), '').replace(/ +/g, ' ').trim());
}

function unique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate Cuckoo standing question id');
}

export function validateQuestions(value: unknown): readonly StandingQuestion[] {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) throw new Error(`Expected at most ${MAX_QUESTIONS} Cuckoo standing questions`);
  const questions = value.map(item => {
    const data = object(item); exact(data, ['id', 'question']);
    return Object.freeze({ id: storedId(data.id), question: storedText(data.question) });
  });
  unique(questions.map(item => item.id));
  return Object.freeze(questions);
}

/** Decode the question snapshot saved with a pending inquiry or a checkpoint. */
export function validateAskedQuestions(value: unknown): readonly AskedQuestion[] {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS * QUESTION_SCOPES.length) throw new Error('Invalid saved Cuckoo standing questions');
  const questions = value.map(item => {
    const data = object(item); exact(data, ['id', 'question', 'scope']);
    if (data.scope !== 'global' && data.scope !== 'project') throw new Error('Invalid Cuckoo standing question scope');
    return Object.freeze({ id: storedId(data.id), question: storedText(data.question), scope: data.scope });
  });
  unique(questions.map(item => item.id));
  return Object.freeze(questions);
}

function validateFile(value: unknown): readonly StandingQuestion[] {
  const data = object(value); exact(data, ['version', 'questions']);
  if (data.version !== 1) throw new Error('Invalid Cuckoo standing questions version');
  return validateQuestions(data.questions);
}

export class FileQuestionStore implements QuestionStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): readonly StandingQuestion[] { return readJsonPreferences(this.path, () => [], validateFile, 'Cuckoo standing questions'); }
  write(value: readonly StandingQuestion[]): void { writeJsonPreferences(this.path, { version: 1, questions: validateQuestions(value) }); }
}

export function questionsText(snapshot: QuestionSnapshot): string {
  const stores = `Global: ${snapshot.paths.global}\nProject: ${snapshot.paths.project}${snapshot.projectTrusted ? '' : ' (ignored: untrusted project)'}`;
  if (snapshot.effective.length === 0) return `No Cuckoo standing questions.\n${stores}`;
  return `Cuckoo standing questions, asked at every checkpoint\n${snapshot.effective.map(item => `  ${item.id} (${item.scope}): ${item.question}`).join('\n')}\n${stores}`;
}

/** Durable standing questions: a global store plus a trusted-project store. */
export class StandingQuestions {
  private readonly global: QuestionStore;
  private readonly projectStore: (path: string) => QuestionStore;
  private readonly nextId: () => string;
  constructor(global: QuestionStore, projectStore: (path: string) => QuestionStore, nextId: () => string) {
    this.global = global; this.projectStore = projectStore; this.nextId = nextId;
  }

  private store(ctx: QuestionContext, scope: QuestionScope): QuestionStore {
    if (scope === 'global') return this.global;
    if (!ctx.isProjectTrusted()) throw new Error('Project standing questions require a trusted project');
    return this.projectStore(join(ctx.cwd, CONFIG_DIR_NAME, QUESTIONS_FILE));
  }

  read(ctx: QuestionContext): QuestionSnapshot {
    const projectTrusted = ctx.isProjectTrusted();
    const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, QUESTIONS_FILE);
    const effective: AskedQuestion[] = this.global.read().map(item => ({ ...item, scope: 'global' }));
    if (projectTrusted) for (const item of this.store(ctx, 'project').read()) {
      // The model answers by id, so one id must name one question; a copied file is the usual cause.
      if (effective.some(other => other.id === item.id)) throw new Error(`Standing question id ${item.id} is used in both ${this.global.path} and ${projectPath}; remove it from one of them`);
      effective.push({ ...item, scope: 'project' });
    }
    return { effective, projectTrusted, paths: { global: this.global.path, project: projectPath } };
  }

  add(ctx: QuestionContext, scope: QuestionScope, text: string): AskedQuestion {
    const question = questionText(text);
    const taken = new Set(this.read(ctx).effective.map(item => item.id));
    const store = this.store(ctx, scope), current = store.read();
    if (current.length >= MAX_QUESTIONS) throw new Error(`At most ${MAX_QUESTIONS} ${scope} standing questions are allowed`);
    if (current.some(item => item.question === question)) throw new Error(`That ${scope} standing question already exists`);
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const id = `q-${this.nextId().replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`;
      if (taken.has(id)) continue;
      store.write([...current, { id: storedId(id), question }]);
      return { id, question, scope };
    }
    throw new Error('Could not allocate a unique standing question id');
  }

  /** Remove by id; a null scope searches every readable store. */
  remove(ctx: QuestionContext, scope: QuestionScope | null, id: string): AskedQuestion {
    for (const candidate of QUESTION_SCOPES) {
      if (scope !== null && scope !== candidate) continue;
      if (scope === null && candidate === 'project' && !ctx.isProjectTrusted()) continue;
      const store = this.store(ctx, candidate), current = store.read();
      const found = current.find(item => item.id === id);
      if (found === undefined) continue;
      store.write(current.filter(item => item.id !== id));
      return { ...found, scope: candidate };
    }
    throw new Error(`No ${scope === null ? '' : `${scope} `}standing question has id ${id}`);
  }
}
