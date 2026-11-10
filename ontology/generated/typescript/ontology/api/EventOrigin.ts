import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum EventOrigin {
    UserMessage = "UserMessage",
    WorkerMessage = "WorkerMessage",
    ToolOutput = "ToolOutput"
}

export const EventOrigin_values: ReadonlyArray<EventOrigin> = [
    EventOrigin.UserMessage,
    EventOrigin.WorkerMessage,
    EventOrigin.ToolOutput
] as const;

export function EventOrigin_parse(s: string): EventOrigin {
    const found = EventOrigin_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown EventOrigin variant: " + s);
    }
    return found;
}

export class EventOrigin_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: EventOrigin): unknown {
        if (this !== EventOrigin_JsonCodec.lazyInstance.value) {
          return EventOrigin_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): EventOrigin {
        if (this !== EventOrigin_JsonCodec .lazyInstance.value) {
            return EventOrigin_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return EventOrigin_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return EventOrigin_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return EventOrigin_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#EventOrigin'
    public baboonTypeIdentifier() {
        return EventOrigin_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new EventOrigin_JsonCodec())
    public static get instance(): EventOrigin_JsonCodec {
        return EventOrigin_JsonCodec.lazyInstance.value
    }
}