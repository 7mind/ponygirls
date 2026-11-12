import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class SourceRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _after: bigint;
    private readonly _limit: number;

    constructor(scope: string, after: bigint, limit: number) {
        this._scope = scope
        this._after = after
        this._limit = limit
    }

    public get scope(): string {
        return this._scope;
    }
    public get after(): bigint {
        return this._after;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            after: this._after,
            limit: this._limit
        };
    }

    public with(overrides: {scope?: string; after?: bigint; limit?: number}): SourceRequest {
        return new SourceRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'after' in overrides ? overrides.after! : this._after,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {scope: string; after: bigint; limit: number}): SourceRequest {
        return new SourceRequest(
            obj.scope,
            obj.after,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceRequest'
    public baboonTypeIdentifier() {
        return SourceRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SourceRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SourceRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SourceRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): SourceRequest_JsonCodec {
        return SourceRequest_JsonCodec.instance
    }
}

export class SourceRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceRequest): unknown {
        if (this !== SourceRequest_JsonCodec.lazyInstance.value) {
          return SourceRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "after": value.after.toString(),
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceRequest {
        if (this !== SourceRequest_JsonCodec .lazyInstance.value) {
            return SourceRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SourceRequest (
            obj["scope"] as string,
            BaboonInt64.read(obj["after"], "i64/u64"),
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceRequest'
    public baboonTypeIdentifier() {
        return SourceRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceRequest_JsonCodec())
    public static get instance(): SourceRequest_JsonCodec {
        return SourceRequest_JsonCodec.lazyInstance.value
    }
}