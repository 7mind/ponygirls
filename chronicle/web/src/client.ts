import { BaboonCodecContext, LoginRequest, LoginRequest_JsonCodec, LoginResponse_JsonCodec, Failure_JsonCodec, type LoginResponse, type Operation, type Result } from './api.ts';
import type { ConnectionManager } from './transport/manager.ts';
export type ChronicleConnection = ConnectionManager<Operation, Result>;
export async function login(fetcher: typeof fetch, username: string, password: string): Promise<LoginResponse> {
  const response = await fetcher('/api/login', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(LoginRequest_JsonCodec.instance.encode(BaboonCodecContext.Default, new LoginRequest(username, password))),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const failure = Failure_JsonCodec.instance.decode(BaboonCodecContext.Default, json);
    throw new Error(failure.message);
  }
  return LoginResponse_JsonCodec.instance.decode(BaboonCodecContext.Default, json);
}
export async function read<T>(connection: ChronicleConnection, operation: Operation, extract: (result: Result) => T | null): Promise<T> {
  const result = await connection.request(operation, { mutation: false, receiptId: null });
  const value = extract(result);
  if (value === null) throw new Error('The server returned an unexpected result type');
  return value;
}
export function mutate(connection: ChronicleConnection, operation: Operation, id: string): Promise<Result> {
  return connection.request(operation, { mutation: true, receiptId: id });
}
