import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Result, Result_JsonCodec} from './Result.js'

export class ServerEnvelope implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _result: Result;

    constructor(requestId: string, result: Result) {
        this._requestId = requestId
        this._result = result
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get result(): Result {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            result: this._result
        };
    }

    public with(overrides: {requestId?: string; result?: Result}): ServerEnvelope {
        return new ServerEnvelope(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {requestId: string; result: Result}): ServerEnvelope {
        return new ServerEnvelope(
            obj.requestId,
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ServerEnvelope.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ServerEnvelope.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ServerEnvelope'
    public baboonTypeIdentifier() {
        return ServerEnvelope.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return ServerEnvelope.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return ServerEnvelope.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ServerEnvelope.BaboonMinReaderVersions
    }
    public static jsonCodec(): ServerEnvelope_JsonCodec {
        return ServerEnvelope_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.7.0 */
export class ServerEnvelope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ServerEnvelope): unknown {
        if (this !== ServerEnvelope_JsonCodec.lazyInstance.value) {
          return ServerEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "result": Result_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ServerEnvelope {
        if (this !== ServerEnvelope_JsonCodec .lazyInstance.value) {
            return ServerEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ServerEnvelope (
            obj["requestId"] as string,
            Result_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ServerEnvelope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ServerEnvelope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ServerEnvelope'
    public baboonTypeIdentifier() {
        return ServerEnvelope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ServerEnvelope_JsonCodec())
    public static get instance(): ServerEnvelope_JsonCodec {
        return ServerEnvelope_JsonCodec.lazyInstance.value
    }
}