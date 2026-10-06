/**
 * ponygirls-subagents — the child tool contract shared by worker and broker.
 *
 * File/shell tools keep pi's built-in names and argument shapes (models are
 * trained on them), but execute through the supervisor broker inside the
 * sandbox. Control tools route to the same supervisor methods as the
 * governing session's tools, with the caller derived from the worker channel.
 *
 * Schemas are built with whichever TypeBox instance the caller holds (the
 * worker loads pi's at runtime), so this module stays dependency-free.
 */

import { err } from "./errors.ts";

export const FILE_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITE_TOOLS = ["write", "edit"] as const;
export const SHELL_TOOL = "bash";
export const GATE_DECISION_TOOL = "submit_gate_decision";
/** Control tools every non-reviewer child holds (parent contact, own subtree). */
export const CHILD_CONTROL_TOOLS = ["send_message", "wait_agent", "list_agents", "read_agent"] as const;
/** Control tools a child holds only when it may delegate. */
export const DELEGATION_TOOLS = ["spawn_agent", "interrupt_agent", "close_agent"] as const;

export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
/** read: at most this many lines and bytes per call (pi's own limits), continued with offset. */
const READ_DEFAULT_LINES = 2000;
const READ_MAX_BYTES = 50 * 1024;
export const BASH_MAX_TIMEOUT_MS = 600_000;
export const MAX_COMMAND_BYTES = 32 * 1024;

/** Structural subset of TypeBox's `Type` used here (schemas stay opaque). */
export interface TypeBuilder<S> {
  Object(properties: Record<string, S>, options?: Record<string, unknown>): S;
  String(options?: Record<string, unknown>): S;
  Number(options?: Record<string, unknown>): S;
  Integer(options?: Record<string, unknown>): S;
  Boolean(options?: Record<string, unknown>): S;
  Array(items: S, options?: Record<string, unknown>): S;
  Optional(schema: S): S;
  Union(schemas: S[], options?: Record<string, unknown>): S;
  Literal(value: string): S;
  Null(): S;
}

export interface ToolSpec<S> {
  description: string;
  parameters: S;
}

export function childToolSpec<S>(T: TypeBuilder<S>, name: string): ToolSpec<S> {
  switch (name) {
    case "read":
      return {
        description: "Read a text file inside your workspace view. Output is limited to `limit` lines (default 2000) from `offset`; continue with offset for large files.",
        parameters: T.Object({
          path: T.String({ description: "Path to the file (relative to the working directory or absolute)" }),
          offset: T.Optional(T.Integer({ minimum: 1, description: "Line number to start reading from (1-indexed)" })),
          limit: T.Optional(T.Integer({ minimum: 1, description: "Maximum number of lines to read" })),
        }),
      };
    case "grep":
      return {
        description: "Search file contents (regex or literal) inside your workspace view. Skips .git and node_modules.",
        parameters: T.Object({
          pattern: T.String({ description: "Search pattern (regex, or literal string with literal=true)" }),
          path: T.Optional(T.String({ description: "Directory or file to search (default: working directory)" })),
          glob: T.Optional(T.String({ description: "Only search files matching this glob, e.g. '*.ts' or 'src/**/*.ts'" })),
          ignoreCase: T.Optional(T.Boolean()),
          literal: T.Optional(T.Boolean()),
          context: T.Optional(T.Integer({ minimum: 0, description: "Lines of context around each match" })),
          limit: T.Optional(T.Integer({ minimum: 1, description: "Maximum matches (default 100)" })),
        }),
      };
    case "find":
      return {
        description: "Find files and directories by glob inside your workspace view. Patterns without '/' match names; patterns with '/' match relative paths.",
        parameters: T.Object({
          pattern: T.String({ description: "Glob, e.g. '*.ts', '**/*.json', 'src/**/*.spec.ts'" }),
          path: T.Optional(T.String({ description: "Directory to search (default: working directory)" })),
          limit: T.Optional(T.Integer({ minimum: 1, description: "Maximum results (default 1000)" })),
        }),
      };
    case "ls":
      return {
        description: "List a directory inside your workspace view (directories end with '/').",
        parameters: T.Object({
          path: T.Optional(T.String({ description: "Directory to list (default: working directory)" })),
          limit: T.Optional(T.Integer({ minimum: 1, description: "Maximum entries (default 500)" })),
        }),
      };
    case "write":
      return {
        description: "Create or overwrite a file inside your assigned worktree.",
        parameters: T.Object({
          path: T.String({ description: "Path to the file (relative to the worktree or absolute inside it)" }),
          content: T.String({ description: "Full file content" }),
        }),
      };
    case "edit":
      return {
        description: "Edit a file inside your assigned worktree with exact text replacements. Each edits[].oldText must occur exactly once in the original file; edits must not overlap.",
        parameters: T.Object({
          path: T.String({ description: "Path to the file to edit" }),
          edits: T.Array(
            T.Object({
              oldText: T.String({ description: "Exact text to replace; unique in the original file" }),
              newText: T.String({ description: "Replacement text" }),
            }),
            { minItems: 1 },
          ),
        }),
      };
    case "bash":
      return {
        description: "Run a shell command in the restricted sandbox: your worktree is writable, there is no network, and your home directory is private scratch.",
        parameters: T.Object({
          command: T.String({ description: "Shell command to execute" }),
          timeout: T.Optional(T.Number({ description: "Timeout in seconds (default 120, maximum 600)" })),
        }),
      };
    case "submit_gate_decision": {
      const finding = T.Object({
        id: T.String(),
        target: T.String(),
        problem: T.String(),
        requiredChange: T.String(),
        evidenceRefs: T.Array(T.String()),
      });
      return {
        description: "Submit your single structured review decision. approve: advisories only. revise: at least one blocker. blocked: reason plus missingPrerequisites. Exactly one submission per review.",
        parameters: T.Object({
          schemaVersion: T.Integer({ description: "Always 1" }),
          candidateId: T.String({ description: "The candidate id named in the review prompt" }),
          decision: T.Union([T.Literal("approve"), T.Literal("revise"), T.Literal("blocked")]),
          blockers: T.Optional(T.Array(finding)),
          advisories: T.Optional(T.Array(finding)),
          reason: T.Optional(T.String()),
          missingPrerequisites: T.Optional(T.Array(T.String())),
        }),
      };
    }
    case "send_message":
      return {
        description: "Send a durable attributed message. target is 'parent' or an agent id in your own subtree. mode note persists without starting work; steer affects a running generation; task schedules a new task run for a descendant. request_reply asks a question (then call wait_agent for the answer); reply_to answers one.",
        parameters: T.Object({
          target: T.String({ description: "'parent' or a descendant agent id" }),
          message: T.String(),
          mode: T.Union([T.Literal("note"), T.Literal("steer"), T.Literal("task")]),
          request_reply: T.Optional(T.Boolean()),
          reply_to: T.Optional(T.String()),
        }),
      };
    case "wait_agent":
      return {
        description: "Wait for durable events after a cursor; returns a bounded batch, messages addressed to you (with text), and a new cursor. condition activity, any_settled, or all_settled (targets capture exact task-run ids). Your runnable slot is released while you wait.",
        parameters: waitParameters(T),
      };
    case "list_agents":
      return { description: "List the agents visible to you (your parent and your subtree).", parameters: T.Object({}) };
    case "read_agent":
      return { description: "Read status, the latest result, or bounded events of a visible agent.", parameters: readParameters(T) };
    case "spawn_agent":
      return {
        description: "Delegate a task to a new child agent in your subtree. Returns immediately with its id and task-run id; use wait_agent to join it. You must wait for (or close) your children before finishing. A child is never less isolated than you; it can receive only skills and context files you have.",
        parameters: spawnParameters(T, {}),
      };
    case "interrupt_agent":
      return { description: "Interrupt a descendant's active task run (and its descendants).", parameters: T.Object({ target: T.String() }) };
    case "close_agent":
      return { description: "Permanently close a descendant subtree; sessions and worktrees are preserved.", parameters: T.Object({ target: T.String() }) };
    default:
      throw err("INVALID", `no child tool named ${name}`);
  }
}

/** spawn_agent arguments shared by the governing tool and child delegation. */
export function spawnParameters<S>(T: TypeBuilder<S>, extra: Record<string, S>): S {
  return T.Object({
    task_name: T.String({ description: "Short task name; becomes part of the canonical path" }),
    message: T.String({ description: "Initial task text (the child sees only this, not your conversation)" }),
    profile: T.Union([T.Literal("reader"), T.Literal("writer")], { description: "reader: read/grep/find/ls; writer: adds write/edit/bash" }),
    isolation: T.Optional(T.Union([T.Literal("none"), T.Literal("worktree"), T.Literal("sandbox")], {
      description: "worktree (default, or your own isolation if stricter): host tools; a writer edits its own git worktree of your checkout, whose changes stay there (workdir in the result) and are never merged back; none: host tools in your working directory, writers edit it in place; sandbox: bubblewrap view of a registered repository (repo_id), no network",
    })),
    repo_id: T.Optional(T.String({ description: "Registered repository id (sandbox only; required for sandboxed writers)" })),
    base_commit: T.Optional(T.String({ description: "Commit a worktree/sandbox writer starts from (default HEAD; required when the checkout is dirty)" })),
    skills: T.Optional(T.Array(T.String(), { description: "Names of your skills to pass to the child (omitted: none)" })),
    all_skills: T.Optional(T.Boolean({ description: "Pass every skill you have (instead of listing skills)" })),
    context_files: T.Optional(T.Array(T.String(), { description: "Paths of your context files (AGENTS.md and the like, as shown in your project context) to pass to the child (omitted: none)" })),
    all_context_files: T.Optional(T.Boolean({ description: "Pass every context file you have (instead of listing context_files)" })),
    ...extra,
  });
}

/** A validation gate specification (spawn_agent and manage_gate retry_review). */
export function gateParameters<S>(T: TypeBuilder<S>): S {
  return T.Object({
    model: T.Object({ provider: T.String(), id: T.String() }, { description: "Reviewer model (must be allowlisted)" }),
    thinkingLevel: T.String(),
    prompt: T.String({ description: "Frozen rubric the reviewer judges the candidate against" }),
    maxRounds: T.Optional(T.Union([T.Integer({ minimum: 1 }), T.Null()], { description: "Review rounds (default 3; null: unlimited if policy allows)" })),
    checks: T.Optional(T.Array(T.Object({
      id: T.String({ description: "Unique id; the reviewer cites its output as <id>:output" }),
      command: T.String({ description: "bash command run in the writer's workspace" }),
      timeoutMs: T.Optional(T.Integer({ minimum: 1, maximum: BASH_MAX_TIMEOUT_MS, description: `Default ${BASH_DEFAULT_TIMEOUT_MS}` })),
    }), { description: "Writers only: commands the controller runs before every review; a non-zero exit forbids approval" })),
    promisedOutputs: T.Optional(T.Array(T.String(), { description: "Writers only: workspace-relative files the deliverable must contain; part of the reviewed candidate" })),
  });
}

export function waitParameters<S>(T: TypeBuilder<S>): S {
  return T.Object({
    cursor: T.Optional(T.Integer({ minimum: 0 })),
    timeout_ms: T.Optional(T.Integer({ minimum: 100, maximum: 300000 })),
    targets: T.Optional(T.Array(T.Object({ agentId: T.String(), taskRunId: T.Union([T.String(), T.Null()]) }))),
    condition: T.Optional(T.Union([T.Literal("activity"), T.Literal("any_settled"), T.Literal("all_settled")])),
  });
}

export function readParameters<S>(T: TypeBuilder<S>): S {
  return T.Object({
    target: T.String(),
    view: T.Union([T.Literal("status"), T.Literal("result"), T.Literal("events")]),
    task_run_id: T.Optional(T.String({ description: "result view: a specific earlier task run (default: the latest)" })),
    cursor: T.Optional(T.Integer({ minimum: 0 })),
    limit: T.Optional(T.Integer({ minimum: 1, maximum: 100 })),
  });
}

// -- broker side: argument validation and sandboxed implementations ---------

function str(args: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw err("INVALID", `${key} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw err("INVALID", `${key} must be a string`);
  if (required && v.length === 0) throw err("INVALID", `${key} must be nonempty`);
  return v;
}

function posInt(args: Record<string, unknown>, key: string, min: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Number.isInteger(v) || (v as number) < min) throw err("INVALID", `${key} must be an integer >= ${min}`);
  return v as number;
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw err("INVALID", `${key} must be a boolean`);
  return v;
}

/** Validate and normalize file/shell tool arguments (unknown keys dropped). */
export function validateToolArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case "read":
      return { path: str(args, "path", true), offset: posInt(args, "offset", 1), limit: posInt(args, "limit", 1) };
    case "ls":
      return { path: str(args, "path", false), limit: posInt(args, "limit", 1) };
    case "find":
      return { pattern: str(args, "pattern", true), path: str(args, "path", false), limit: posInt(args, "limit", 1) };
    case "grep": {
      const out = {
        pattern: str(args, "pattern", true),
        path: str(args, "path", false),
        glob: str(args, "glob", false),
        ignoreCase: bool(args, "ignoreCase"),
        literal: bool(args, "literal"),
        context: posInt(args, "context", 0),
        limit: posInt(args, "limit", 1),
      };
      if (out.literal !== true) {
        try {
          new RegExp(out.pattern!);
        } catch (e) {
          throw err("INVALID", `pattern is not a valid regular expression: ${(e as Error).message}`);
        }
      }
      return out;
    }
    case "write": {
      if (typeof args["content"] !== "string") throw err("INVALID", "content must be a string");
      return { path: str(args, "path", true), content: args["content"] };
    }
    case "edit": {
      const edits = args["edits"];
      if (!Array.isArray(edits) || edits.length === 0) throw err("INVALID", "edits must be a nonempty array of {oldText, newText}");
      return {
        path: str(args, "path", true),
        edits: edits.map((e, i) => {
          const rec = (e ?? {}) as Record<string, unknown>;
          if (typeof rec["oldText"] !== "string" || rec["oldText"].length === 0) throw err("INVALID", `edits[${i}].oldText must be a nonempty string`);
          if (typeof rec["newText"] !== "string") throw err("INVALID", `edits[${i}].newText must be a string`);
          return { oldText: rec["oldText"], newText: rec["newText"] };
        }),
      };
    }
    case "bash": {
      const command = str(args, "command", true)!;
      if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) throw err("PAYLOAD_TOO_LARGE", "command exceeds 32KiB");
      const timeout = args["timeout"];
      if (timeout !== undefined && timeout !== null && (typeof timeout !== "number" || !(timeout > 0))) throw err("INVALID", "timeout must be a positive number of seconds");
      return { command, timeout: typeof timeout === "number" ? timeout : undefined };
    }
    default:
      throw err("POLICY_DENIED", `no implementation for tool ${tool}`);
  }
}

export function bashTimeoutMs(args: Record<string, unknown>): number {
  const seconds = args["timeout"];
  return typeof seconds === "number" ? Math.min(Math.ceil(seconds * 1000), BASH_MAX_TIMEOUT_MS) : BASH_DEFAULT_TIMEOUT_MS;
}

/**
 * Node scripts for file tools, run inside the sandbox. They are static:
 * arguments arrive as JSON on stdin, never spliced into source.
 */
const PRELUDE = `const fs=require('fs'),path=require('path');const a=JSON.parse(fs.readFileSync(0,'utf8'));
const fail=(m)=>{process.stderr.write(m+'\\n');process.exit(1)};
const globSrc=(g)=>{let r='';for(let i=0;i<g.length;i++){const c=g[i];
if(c==='*'){if(g[i+1]==='*'){i++;if(g[i+1]==='/'){i++;r+='(?:.*/)?'}else r+='.*'}else r+='[^/]*'}
else if(c==='?')r+='[^/]';
else if(c==='['){const j=g.indexOf(']',i+2);if(j<0){r+='\\\\[';continue}let cls=g.slice(i+1,j);if(cls[0]==='!')cls='^'+cls.slice(1);r+='['+cls.replace(/\\\\/g,'\\\\\\\\')+']';i=j}
else if(c==='{'){let depth=0,j=i;for(;j<g.length;j++){if(g[j]==='{')depth++;else if(g[j]==='}'&&--depth===0)break}if(j>=g.length){r+='\\\\{';continue}
const parts=[];let cur='',d=0;for(const ch of g.slice(i+1,j)){if(ch===','&&d===0){parts.push(cur);cur='';continue}if(ch==='{')d++;if(ch==='}')d--;cur+=ch}parts.push(cur);r+='(?:'+parts.map(globSrc).join('|')+')';i=j}
else r+=c.replace(/[.+^\${}()|[\\]\\\\]/g,'\\\\$&')}return r};
const globRe=(g)=>new RegExp('^'+globSrc(g)+'$');
const matcher=(g)=>{const re=globRe(g);return g.includes('/')?(rel)=>re.test(rel):(rel)=>re.test(path.basename(rel))};
const walk=function*(root){const st=[root];while(st.length){const d=st.pop();let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch{continue}es.sort((x,y)=>x.name<y.name?1:-1);for(const e of es){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name==='.git'||e.name==='node_modules')continue;yield {p,dir:true};st.push(p)}else yield {p,dir:false}}}};
`;

export const TOOL_SCRIPTS: Record<string, string> = {
  read: `${PRELUDE}const s=fs.readFileSync(a.path,'utf8');const L=s.split('\\n');const start=a.offset||1;const limit=a.limit||${READ_DEFAULT_LINES};
if(start>L.length&&L.length>0)fail('offset '+start+' is beyond the end of the file ('+L.length+' lines)');
const out=[];let bytes=0,i=start-1;for(;i<L.length&&out.length<limit;i++){const b=Buffer.byteLength(L[i])+1;if(bytes+b>${READ_MAX_BYTES}&&out.length>0)break;out.push(L[i]);bytes+=b}
let text=out.join('\\n');if(i<L.length)text+='\\n\\n[Showing lines '+start+'-'+i+' of '+L.length+(bytes>=${READ_MAX_BYTES}?' (byte limit)':'')+'. Use offset='+(i+1)+' to continue.]';
process.stdout.write(text);`,
  ls: `${PRELUDE}const d=a.path||'.';const lim=a.limit||500;const es=fs.readdirSync(d,{withFileTypes:true}).map(e=>e.isDirectory()?e.name+'/':e.name).sort();
process.stdout.write(es.slice(0,lim).join('\\n')+(es.length>lim?'\\n['+(es.length-lim)+' more entries]':''));`,
  find: `${PRELUDE}const root=a.path||'.';const lim=a.limit||1000;const m=matcher(a.pattern);const out=[];
for(const e of walk(root)){const rel=path.relative(root,e.p);if(m(rel)){out.push(e.dir?e.p+'/':e.p);if(out.length>=lim)break}}
process.stdout.write(out.length?out.join('\\n'):'No files found matching pattern');`,
  grep: `${PRELUDE}const esc=(t)=>t.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');const re=new RegExp(a.literal?esc(a.pattern):a.pattern,a.ignoreCase?'i':'');
const lim=a.limit||100;const ctx=a.context||0;const root=a.path||'.';const single=fs.statSync(root).isFile();const gm=a.glob&&!single?matcher(a.glob):null;const out=[];let n=0;
const files=single?[root]:[...walk(root)].filter(e=>!e.dir).map(e=>e.p);
for(const f of files){if(n>=lim)break;if(gm&&!gm(path.relative(root,f)))continue;let b;try{b=fs.readFileSync(f)}catch{continue}if(b.subarray(0,8192).includes(0))continue;
const L=b.toString('utf8').split('\\n');for(let i=0;i<L.length&&n<lim;i++){if(!re.test(L[i]))continue;n++;
for(let j=Math.max(0,i-ctx);j<i;j++)out.push(f+'-'+(j+1)+'-'+L[j].slice(0,500));out.push(f+':'+(i+1)+':'+L[i].slice(0,500));
for(let j=i+1;j<=Math.min(L.length-1,i+ctx);j++)out.push(f+'-'+(j+1)+'-'+L[j].slice(0,500))}}
process.stdout.write(out.length?out.join('\\n')+(n>=lim?'\\n[match limit '+lim+' reached]':''):'No matches found');`,
  write: `${PRELUDE}fs.mkdirSync(path.dirname(a.path),{recursive:true});fs.writeFileSync(a.path,a.content);
process.stdout.write('Wrote '+Buffer.byteLength(a.content)+' bytes to '+a.path);`,
  edit: `${PRELUDE}const s=fs.readFileSync(a.path,'utf8');const spans=[];
a.edits.forEach((e,i)=>{const at=s.indexOf(e.oldText);if(at<0)fail('edits['+i+'].oldText not found in '+a.path);
if(s.indexOf(e.oldText,at+1)>=0)fail('edits['+i+'].oldText occurs more than once in '+a.path+'; add context to make it unique');
spans.push({start:at,end:at+e.oldText.length,text:e.newText,i})});
spans.sort((x,y)=>x.start-y.start);for(let k=1;k<spans.length;k++)if(spans[k].start<spans[k-1].end)fail('edits['+spans[k-1].i+'] and edits['+spans[k].i+'] overlap in '+a.path);
let out='',pos=0;for(const sp of spans){out+=s.slice(pos,sp.start)+sp.text;pos=sp.end}out+=s.slice(pos);fs.writeFileSync(a.path,out);
process.stdout.write('Applied '+spans.length+' edit(s) to '+a.path);`,
};
