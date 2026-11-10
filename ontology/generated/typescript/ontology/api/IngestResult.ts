import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class IngestResult implements BaboonGeneratedLatest {
    private readonly _source: Ref;
    private readonly _frontier: bigint;
    private readonly _replayed: boolean;

    constructor(source: Ref, frontier: bigint, replayed: boolean) {
        this._source = source
        this._frontier = frontier
        this._replayed = replayed
    }

    public get source(): Ref {
        return this._source;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get replayed(): boolean {
        return this._replayed;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source,
            frontier: this._frontier,
            replayed: this._replayed
        };
    }

    public with(overrides: {source?: Ref; frontier?: bigint; replayed?: boolean}): IngestResult {
        return new IngestResult(
            'source' in overrides ? overrides.source! : this._source,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'replayed' in overrides ? overrides.replayed! : this._replayed
        );
    }

    public static fromPlain(obj: {source: Ref; frontier: bigint; replayed: boolean}): IngestResult {
        return new IngestResult(
            obj.source,
            obj.frontier,
            obj.replayed
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestResult'
    public baboonTypeIdentifier() {
        return IngestResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return IngestResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return IngestResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return IngestResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): IngestResult_JsonCodec {
        return IngestResult_JsonCodec.instance
    }
}

export class IngestResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IngestResult): unknown {
        if (this !== IngestResult_JsonCodec.lazyInstance.value) {
          return IngestResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "frontier": value.frontier.toString(),
            "replayed": value.replayed,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IngestResult {
        if (this !== IngestResult_JsonCodec .lazyInstance.value) {
            return IngestResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IngestResult (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            obj["replayed"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestResult'
    public baboonTypeIdentifier() {
        return IngestResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IngestResult_JsonCodec())
    public static get instance(): IngestResult_JsonCodec {
        return IngestResult_JsonCodec.lazyInstance.value
    }
}