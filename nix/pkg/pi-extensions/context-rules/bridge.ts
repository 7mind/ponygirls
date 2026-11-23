import type { ContextFile, Discovery } from "./rules.ts";

export interface RootBinding { rootSessionId: string; cwd: string }
export interface Admission { grants: Discovery; mainFiles: ContextFile[] }
export interface InventoryRow {
  agentId: string;
  parentId: string | null;
  label: string;
  state: string;
  paths: string[];
  complete: boolean;
}
export interface BridgeRequest<T> extends RootBinding { respond(value: T): void }
export const ADMISSION_CHANNEL = "ponygirls:archeologist:admission:v1";
export const INVENTORY_CHANNEL = "ponygirls:archeologist:inventory:v1";

interface Events { emit(channel: string, data: unknown): void }
function request<T>(bus: Events, channel: string, binding: RootBinding): T | undefined {
  let reply: T | undefined;
  bus.emit(channel, { ...binding, respond: (value: T) => { reply = value; } } satisfies BridgeRequest<T>);
  return reply;
}
export function requestAdmission(bus: Events, binding: RootBinding): Admission | undefined {
  return request(bus, ADMISSION_CHANNEL, binding);
}
export function requestInventory(bus: Events, binding: RootBinding): InventoryRow[] | undefined {
  return request(bus, INVENTORY_CHANNEL, binding);
}
