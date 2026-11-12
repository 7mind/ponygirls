import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class QueryLimitsResult implements BaboonGeneratedLatest {
    private readonly _maxPageRecords: number;

    constructor(maxPageRecords: number) {
        this._maxPageRecords = maxPageRecords
    }

    public get maxPageRecords(): number {
        return this._maxPageRecords;
    }

    public toJSON(): Record<string, unknown> {
        return {
            maxPageRecords: this._maxPageRecords
        };
    }

    public with(overrides: {maxPageRecords?: number}): QueryLimitsResult {
        return new QueryLimitsResult(
            'maxPageRecords' in overrides ? overrides.maxPageRecords! : this._maxPageRecords
        );
    }

    public static fromPlain(obj: {maxPageRecords: number}): QueryLimitsResult {
        return new QueryLimitsResult(
            obj.maxPageRecords
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return QueryLimitsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return QueryLimitsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#QueryLimitsResult'
    public baboonTypeIdentifier() {
        return QueryLimitsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return QueryLimitsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return QueryLimitsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return QueryLimitsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): QueryLimitsResult_JsonCodec {
        return QueryLimitsResult_JsonCodec.instance
    }
}

export class QueryLimitsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: QueryLimitsResult): unknown {
        if (this !== QueryLimitsResult_JsonCodec.lazyInstance.value) {
          return QueryLimitsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "maxPageRecords": value.maxPageRecords,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): QueryLimitsResult {
        if (this !== QueryLimitsResult_JsonCodec .lazyInstance.value) {
            return QueryLimitsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new QueryLimitsResult (
            obj["maxPageRecords"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return QueryLimitsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return QueryLimitsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#QueryLimitsResult'
    public baboonTypeIdentifier() {
        return QueryLimitsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new QueryLimitsResult_JsonCodec())
    public static get instance(): QueryLimitsResult_JsonCodec {
        return QueryLimitsResult_JsonCodec.lazyInstance.value
    }
}