import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RequestTransport {
    Bearer = "Bearer",
    Cookie = "Cookie",
    Internal = "Internal"
}

export const RequestTransport_values: ReadonlyArray<RequestTransport> = [
    RequestTransport.Bearer,
    RequestTransport.Cookie,
    RequestTransport.Internal
] as const;

export function RequestTransport_parse(s: string): RequestTransport {
    const found = RequestTransport_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RequestTransport variant: " + s);
    }
    return found;
}

export class RequestTransport_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RequestTransport): unknown {
        if (this !== RequestTransport_JsonCodec.lazyInstance.value) {
          return RequestTransport_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RequestTransport {
        if (this !== RequestTransport_JsonCodec .lazyInstance.value) {
            return RequestTransport_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RequestTransport_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RequestTransport_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RequestTransport_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RequestTransport'
    public baboonTypeIdentifier() {
        return RequestTransport_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RequestTransport_JsonCodec())
    public static get instance(): RequestTransport_JsonCodec {
        return RequestTransport_JsonCodec.lazyInstance.value
    }
}