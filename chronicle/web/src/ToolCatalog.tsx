import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { McpToolDefinition } from './api.ts';
import { toolRequestExample } from './tool-examples.ts';
import './tool-catalog.css';

type CatalogTab = 'schema' | 'examples';
export function ToolCatalog({ tools }: { tools: readonly McpToolDefinition[] }) {
  const first = tools[0];
  if (first === undefined) throw new Error('A validated MCP tool catalog must not be empty.');
  const [selectedName, selectTool] = useState(first.name), [tab, selectTab] = useState<CatalogTab>('schema');
  const id = useId(), schemaButton = useRef<HTMLButtonElement>(null), examplesButton = useRef<HTMLButtonElement>(null);
  const selected = tools.find(tool => tool.name === selectedName) ?? first;
  useEffect(() => { if (!tools.some(tool => tool.name === selectedName)) selectTool(first.name); }, [tools, selectedName, first.name]);
  const schema = JSON.stringify(JSON.parse(selected.inputSchemaJson), null, 2), example = toolRequestExample(selected.name);
  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    let next: CatalogTab;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'schema' ? 'examples' : 'schema';
    else if (event.key === 'Home') next = 'schema';
    else if (event.key === 'End') next = 'examples';
    else return;
    event.preventDefault(); selectTab(next);
    const button = next === 'schema' ? schemaButton.current : examplesButton.current;
    if (button === null) throw new Error('The active catalog tab must have a mounted control.');
    button.focus();
  }
  return <section className="tool-catalog" aria-label="Actual tool catalog">
    <div className="tool-catalog-heading"><h3>Actual tool catalog ({tools.length})</h3><span className="tiny">Current server definitions</span></div>
    <div className="tool-catalog-layout">
      <div className="tool-catalog-list" role="group" aria-label="MCP tools">{tools.map(tool => <button type="button" key={tool.name} aria-pressed={tool.name === selected.name} onClick={() => selectTool(tool.name)}><code>{tool.name}</code></button>)}</div>
      <div className="tool-catalog-inspector">
        <header><h3>{selected.name}</h3><p>{selected.description}</p></header>
        <div className="tool-catalog-tabs" role="tablist" aria-label="Tool details">
          <button ref={schemaButton} type="button" role="tab" id={`${id}-schema-tab`} aria-controls={`${id}-schema-panel`} aria-selected={tab === 'schema'} tabIndex={tab === 'schema' ? 0 : -1} onKeyDown={keydown} onClick={() => selectTab('schema')}>SCHEMA</button>
          <button ref={examplesButton} type="button" role="tab" id={`${id}-examples-tab`} aria-controls={`${id}-examples-panel`} aria-selected={tab === 'examples'} tabIndex={tab === 'examples' ? 0 : -1} onKeyDown={keydown} onClick={() => selectTab('examples')}>EXAMPLES</button>
        </div>
        <div className="tool-catalog-panel" role="tabpanel" id={`${id}-schema-panel`} aria-labelledby={`${id}-schema-tab`} hidden={tab !== 'schema'}><p className="tiny">Input JSON Schema · supplied by the current server catalog</p><pre tabIndex={0} aria-label="Input JSON Schema">{schema}</pre></div>
        <div className="tool-catalog-panel" role="tabpanel" id={`${id}-examples-panel`} aria-labelledby={`${id}-examples-tab`} hidden={tab !== 'examples'}>{example === null ? <p>No curated example is available for this tool. Consult its current schema.</p> : <><p className="tiny">Synthetic JSON-RPC request · not executed. Replace the example session UUID with an authorized session ID. The current schema is authoritative.</p><pre tabIndex={0} aria-label="Example JSON-RPC request">{JSON.stringify(example, null, 2)}</pre></>}</div>
      </div>
    </div>
  </section>;
}
