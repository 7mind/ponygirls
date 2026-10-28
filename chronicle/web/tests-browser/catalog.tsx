import '../src/styles.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolCatalog } from '../src/ToolCatalog.tsx';
import { McpToolDefinition } from '../src/api.ts';
import { toolCatalogFixture } from '../tests/tool-catalog-fixture.ts';
import '../src/mcp-tester.css';

interface Definition { name: string; description: string; inputSchemaJson: string }
interface CatalogControls { replace(definitions: readonly Definition[]): void; clear(): void }
declare global { interface Window { catalogControls: CatalogControls } }
function CatalogHarness() {
  const [tools, setTools] = useState<readonly McpToolDefinition[] | null>(toolCatalogFixture.map(tool => new McpToolDefinition(tool.name, tool.description, JSON.stringify(tool.inputSchema))));
  useEffect(() => { window.catalogControls = { replace: definitions => setTools(definitions.map(tool => new McpToolDefinition(tool.name, tool.description, tool.inputSchemaJson))), clear: () => setTools(null) }; }, []);
  return <main className="management-page mcp-tester">{tools === null ? <p>Catalog cleared</p> : <ToolCatalog tools={tools}/>}</main>;
}
const root = document.getElementById('root');
if (root === null) throw new Error('Missing synthetic root');
createRoot(root).render(<CatalogHarness/>);
