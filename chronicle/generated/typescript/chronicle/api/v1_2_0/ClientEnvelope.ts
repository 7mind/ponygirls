import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Operation, Operation_JsonCodec} from './Operation.js'

export class ClientEnvelope implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _operation: Operation;

    constructor(requestId: string, operation: Operation) {
        this._requestId = requestId
        this._operation = operation
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get operation(): Operation {
        return this._operation;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            operation: this._operation
        };
    }

    public with(overrides: {requestId?: string; operation?: Operation}): ClientEnvelope {
        return new ClientEnvelope(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'operation' in overrides ? overrides.operation! : this._operation
        );
    }

    public static fromPlain(obj: {requestId: string; operation: Operation}): ClientEnvelope {
        return new ClientEnvelope(
            obj.requestId,
            obj.operation
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ClientEnvelope.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ClientEnvelope.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ClientEnvelope'
    public baboonTypeIdentifier() {
        return ClientEnvelope.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0"]
    public baboonSameInVersions() {
        return ClientEnvelope.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical" }
    public baboonForwardReadable() {
        return ClientEnvelope.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return ClientEnvelope.BaboonMinReaderVersions
    }
    public static jsonCodec(): ClientEnvelope_JsonCodec {
        return ClientEnvelope_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.4.0 */
export class ClientEnvelope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ClientEnvelope): unknown {
        if (this !== ClientEnvelope_JsonCodec.lazyInstance.value) {
          return ClientEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "operation": Operation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.operation),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ClientEnvelope {
        if (this !== ClientEnvelope_JsonCodec .lazyInstance.value) {
            return ClientEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ClientEnvelope (
            obj["requestId"] as string,
            Operation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["operation"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ClientEnvelope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ClientEnvelope'
    public baboonTypeIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ClientEnvelope_JsonCodec())
    public static get instance(): ClientEnvelope_JsonCodec {
        return ClientEnvelope_JsonCodec.lazyInstance.value
    }
}