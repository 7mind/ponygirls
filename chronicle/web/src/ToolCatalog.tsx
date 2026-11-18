import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { McpToolDefinition } from './api.ts';
import { Glyph } from './Glyph.tsx';
import { toolRequestExample } from './tool-examples.ts';
import './tool-catalog.css';

type CatalogTab = 'schema' | 'examples';
/** Parameter names of a tool's input schema, for the row's one-line summary. */
function parameterNames(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null || !('properties' in schema)) return [];
  const properties = schema.properties;
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
}
/** The catalogue's tools as expandable rows; an open row shows its description, current input schema and a request example. */
export function ToolCatalog({ tools }: { tools: readonly McpToolDefinition[] }) {
  if (tools.length === 0) throw new Error('A validated MCP tool catalog must not be empty.');
  const [openName, setOpenName] = useState<string | null>(null), [tab, selectTab] = useState<CatalogTab>('schema');
  const id = useId(), schemaButton = useRef<HTMLButtonElement>(null), examplesButton = useRef<HTMLButtonElement>(null);
  const open = tools.find(tool => tool.name === openName) ?? null;
  useEffect(() => { if (openName !== null && open === null) setOpenName(null); }, [open, openName]);
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
  return <div className="tool-catalog" role="group" aria-label="MCP tools">{tools.map(tool => {
    const expanded = tool === open, panelId = `${id}-${tool.name}`, hint = parameterNames(JSON.parse(tool.inputSchemaJson)).join(', ');
    return <div className="tool-entry" key={tool.name}>
      <button type="button" className="tool-row" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenName(expanded ? null : tool.name)}>
        <code className="tool-row-name">{tool.name}</code><span className="grow xs muted truncate" aria-hidden="true">{hint}</span><span className="tool-row-chevron" aria-hidden="true"><Glyph name="chevron-down"/></span>
      </button>
      {expanded && <div className="tool-detail" id={panelId}>
        <p className="tool-description">{tool.description}</p>
        <div className="tabs" role="tablist" aria-label="Tool details">
          <button ref={schemaButton} type="button" className="tab" role="tab" id={`${id}-schema-tab`} aria-controls={`${id}-schema-panel`} aria-selected={tab === 'schema'} tabIndex={tab === 'schema' ? 0 : -1} onKeyDown={keydown} onClick={() => selectTab('schema')}>Schema</button>
          <button ref={examplesButton} type="button" className="tab" role="tab" id={`${id}-examples-tab`} aria-controls={`${id}-examples-panel`} aria-selected={tab === 'examples'} tabIndex={tab === 'examples' ? 0 : -1} onKeyDown={keydown} onClick={() => selectTab('examples')}>Examples</button>
        </div>
        <div role="tabpanel" id={`${id}-schema-panel`} aria-labelledby={`${id}-schema-tab`} hidden={tab !== 'schema'}><pre className="code-block">{JSON.stringify(JSON.parse(tool.inputSchemaJson), null, 2)}</pre></div>
        <div role="tabpanel" id={`${id}-examples-panel`} aria-labelledby={`${id}-examples-tab`} hidden={tab !== 'examples'}><ToolExample name={tool.name}/></div>
      </div>}
    </div>;
  })}</div>;
}
function ToolExample({ name }: { name: string }) {
  const example = toolRequestExample(name);
  return example === null
    ? <p className="xs muted">No curated example is available for this tool. Consult its current schema.</p>
    : <><p className="xs muted">Example only · not executed. Replace session UUIDs with authorized IDs.</p><pre className="code-block">{JSON.stringify(example, null, 2)}</pre></>;
}
