import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum McpTestState {
    Queued = "Queued",
    Running = "Running",
    Complete = "Complete",
    Failed = "Failed",
    Cancelled = "Cancelled",
    AuthorizationLost = "AuthorizationLost",
    Expired = "Expired"
}

export const McpTestState_values: ReadonlyArray<McpTestState> = [
    McpTestState.Queued,
    McpTestState.Running,
    McpTestState.Complete,
    McpTestState.Failed,
    McpTestState.Cancelled,
    McpTestState.AuthorizationLost,
    McpTestState.Expired
] as const;

export function McpTestState_parse(s: string): McpTestState {
    const found = McpTestState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown McpTestState variant: " + s);
    }
    return found;
}

export class McpTestState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestState): unknown {
        if (this !== McpTestState_JsonCodec.lazyInstance.value) {
          return McpTestState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestState {
        if (this !== McpTestState_JsonCodec .lazyInstance.value) {
            return McpTestState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return McpTestState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return McpTestState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestState'
    public baboonTypeIdentifier() {
        return McpTestState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestState_JsonCodec())
    public static get instance(): McpTestState_JsonCodec {
        return McpTestState_JsonCodec.lazyInstance.value
    }
}