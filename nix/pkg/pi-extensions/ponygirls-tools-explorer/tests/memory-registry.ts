/**
 * An in-memory tool registry that behaves like a pi session: activation
 * ignores unknown, hidden and refused names and keeps the order of tools that
 * stay active; a request makes the transcript declare the active tools.
 * tests/registry-contract.ts holds it to the same clauses as PiToolRegistry.
 */
import type { PromptLines, RegisteredTool, RegistrySnapshot, SessionModel, ToolDeclaration, ToolRegistry } from "../src/registry.ts";

export interface MemoryRegistryOptions {
  tools: readonly RegisteredTool[];
  active: readonly string[];
  promptLines: ReadonlyMap<string, PromptLines>;
  model: SessionModel | null;
}

export class InMemoryToolRegistry implements ToolRegistry {
  private tools: RegisteredTool[];
  private active: string[];
  private readonly promptLines: Map<string, PromptLines>;
  private model: SessionModel | null;
  private declared = new Map<string, ToolDeclaration>();
  private withheld: string[] = [];
  private promptLinesSent = true;
  /** Names pi would refuse to activate, as `--tools` does for MCP tools it does not match. */
  private readonly refused = new Set<string>();

  constructor(options: MemoryRegistryOptions) {
    this.tools = [...options.tools];
    this.active = [];
    this.promptLines = new Map(options.promptLines);
    this.model = options.model;
    this.setActive(options.active);
  }

  snapshot(): RegistrySnapshot {
    return {
      tools: [...this.tools],
      active: [...this.active],
      withheld: this.withheld.filter((name) => this.active.includes(name)),
      promptLines: new Map(this.promptLines),
      promptLinesSent: this.promptLinesSent,
      declared: new Map(this.declared),
      model: this.model,
    };
  }

  setActive(names: readonly string[]): void {
    const requested = new Set(names);
    const kept = this.active.filter((name) => requested.has(name));
    this.active = [...new Set([...kept, ...requested])].filter((name) => {
      const tool = this.tools.find((candidate) => candidate.name === name);
      return tool !== undefined && tool.exposure !== "hidden" && !this.refused.has(name);
    });
  }

  /** One model request: the transcript now declares exactly the active tools. */
  request(): void {
    this.declared = new Map(this.tools.filter((tool) => this.active.includes(tool.name))
      .map((tool) => [tool.name, { name: tool.name, description: tool.description, parameters: tool.parameters }]));
  }

  /** Register a tool after startup, as a connecting MCP server does. */
  register(tool: RegisteredTool): void {
    this.tools = [...this.tools.filter((candidate) => candidate.name !== tool.name), tool];
  }

  unregister(name: string): void {
    this.tools = this.tools.filter((tool) => tool.name !== name);
    this.active = this.active.filter((active) => active !== name);
  }

  refuse(name: string): void {
    this.refused.add(name);
  }

  withhold(names: readonly string[]): void {
    this.withheld = [...names];
  }

  redeclare(declaration: ToolDeclaration): void {
    this.declared.set(declaration.name, declaration);
  }

  setPromptLinesSent(sent: boolean): void {
    this.promptLinesSent = sent;
  }

  /** Switch the session to another model, as /model does. */
  setModel(model: SessionModel | null): void {
    this.model = model;
  }
}
