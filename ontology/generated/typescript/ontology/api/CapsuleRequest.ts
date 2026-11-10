import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'

export class CapsuleRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _context: CaptureContext;
    private readonly _expectedFrontier: bigint;

    constructor(scope: string, context: CaptureContext, expectedFrontier: bigint) {
        this._scope = scope
        this._context = context
        this._expectedFrontier = expectedFrontier
    }

    public get scope(): string {
        return this._scope;
    }
    public get context(): CaptureContext {
        return this._context;
    }
    public get expectedFrontier(): bigint {
        return this._expectedFrontier;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            context: this._context,
            expectedFrontier: this._expectedFrontier
        };
    }

    public with(overrides: {scope?: string; context?: CaptureContext; expectedFrontier?: bigint}): CapsuleRequest {
        return new CapsuleRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'context' in overrides ? overrides.context! : this._context,
            'expectedFrontier' in overrides ? overrides.expectedFrontier! : this._expectedFrontier
        );
    }

    public static fromPlain(obj: {scope: string; context: CaptureContext; expectedFrontier: bigint}): CapsuleRequest {
        return new CapsuleRequest(
            obj.scope,
            obj.context,
            obj.expectedFrontier
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleRequest'
    public baboonTypeIdentifier() {
        return CapsuleRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleRequest_JsonCodec {
        return CapsuleRequest_JsonCodec.instance
    }
}

export class CapsuleRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleRequest): unknown {
        if (this !== CapsuleRequest_JsonCodec.lazyInstance.value) {
          return CapsuleRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "expectedFrontier": value.expectedFrontier.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleRequest {
        if (this !== CapsuleRequest_JsonCodec .lazyInstance.value) {
            return CapsuleRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleRequest (
            obj["scope"] as string,
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            BaboonInt64.read(obj["expectedFrontier"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleRequest'
    public baboonTypeIdentifier() {
        return CapsuleRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleRequest_JsonCodec())
    public static get instance(): CapsuleRequest_JsonCodec {
        return CapsuleRequest_JsonCodec.lazyInstance.value
    }
}