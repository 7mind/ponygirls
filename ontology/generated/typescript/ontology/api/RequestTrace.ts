import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RequestTransport, RequestTransport_JsonCodec} from './RequestTransport.js'

export class RequestTrace implements BaboonGeneratedLatest {
    private readonly _hostRequestId: string;
    private readonly _operation: string;
    private readonly _transport: RequestTransport;

    constructor(hostRequestId: string, operation: string, transport: RequestTransport) {
        this._hostRequestId = hostRequestId
        this._operation = operation
        this._transport = transport
    }

    public get hostRequestId(): string {
        return this._hostRequestId;
    }
    public get operation(): string {
        return this._operation;
    }
    public get transport(): RequestTransport {
        return this._transport;
    }

    public toJSON(): Record<string, unknown> {
        return {
            hostRequestId: this._hostRequestId,
            operation: this._operation,
            transport: this._transport
        };
    }

    public with(overrides: {hostRequestId?: string; operation?: string; transport?: RequestTransport}): RequestTrace {
        return new RequestTrace(
            'hostRequestId' in overrides ? overrides.hostRequestId! : this._hostRequestId,
            'operation' in overrides ? overrides.operation! : this._operation,
            'transport' in overrides ? overrides.transport! : this._transport
        );
    }

    public static fromPlain(obj: {hostRequestId: string; operation: string; transport: RequestTransport}): RequestTrace {
        return new RequestTrace(
            obj.hostRequestId,
            obj.operation,
            obj.transport
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RequestTrace.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RequestTrace.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RequestTrace'
    public baboonTypeIdentifier() {
        return RequestTrace.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RequestTrace.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RequestTrace.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RequestTrace.BaboonMinReaderVersions
    }
    public static jsonCodec(): RequestTrace_JsonCodec {
        return RequestTrace_JsonCodec.instance
    }
}

export class RequestTrace_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RequestTrace): unknown {
        if (this !== RequestTrace_JsonCodec.lazyInstance.value) {
          return RequestTrace_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "hostRequestId": value.hostRequestId,
            "operation": value.operation,
            "transport": RequestTransport_JsonCodec.instance.encode(BaboonCodecContext.Default, value.transport),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RequestTrace {
        if (this !== RequestTrace_JsonCodec .lazyInstance.value) {
            return RequestTrace_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RequestTrace (
            obj["hostRequestId"] as string,
            obj["operation"] as string,
            RequestTransport_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["transport"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RequestTrace_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RequestTrace_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RequestTrace'
    public baboonTypeIdentifier() {
        return RequestTrace_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RequestTrace_JsonCodec())
    public static get instance(): RequestTrace_JsonCodec {
        return RequestTrace_JsonCodec.lazyInstance.value
    }
}