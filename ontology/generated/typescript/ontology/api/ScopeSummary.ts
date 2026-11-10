import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationState, CurationState_JsonCodec} from './CurationState.js'

export class ScopeSummary implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _curation: CurationState;
    private readonly _failure: string | undefined;
    private readonly _rdfGeneration: bigint | undefined;

    constructor(scope: string, generation: bigint, frontier: bigint, coveredFrontier: bigint, curation: CurationState, failure: string | undefined, rdfGeneration: bigint | undefined) {
        this._scope = scope
        this._generation = generation
        this._frontier = frontier
        this._coveredFrontier = coveredFrontier
        this._curation = curation
        this._failure = failure
        this._rdfGeneration = rdfGeneration
    }

    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get curation(): CurationState {
        return this._curation;
    }
    public get failure(): string | undefined {
        return this._failure;
    }
    public get rdfGeneration(): bigint | undefined {
        return this._rdfGeneration;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            frontier: this._frontier,
            coveredFrontier: this._coveredFrontier,
            curation: this._curation,
            failure: this._failure !== undefined ? this._failure : undefined,
            rdfGeneration: this._rdfGeneration !== undefined ? this._rdfGeneration : undefined
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; frontier?: bigint; coveredFrontier?: bigint; curation?: CurationState; failure?: string | undefined; rdfGeneration?: bigint | undefined}): ScopeSummary {
        return new ScopeSummary(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'curation' in overrides ? overrides.curation! : this._curation,
            'failure' in overrides ? overrides.failure! : this._failure,
            'rdfGeneration' in overrides ? overrides.rdfGeneration! : this._rdfGeneration
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; frontier: bigint; coveredFrontier: bigint; curation: CurationState; failure: string | undefined; rdfGeneration: bigint | undefined}): ScopeSummary {
        return new ScopeSummary(
            obj.scope,
            obj.generation,
            obj.frontier,
            obj.coveredFrontier,
            obj.curation,
            obj.failure,
            obj.rdfGeneration
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopeSummary.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopeSummary.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopeSummary'
    public baboonTypeIdentifier() {
        return ScopeSummary.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ScopeSummary.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ScopeSummary.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ScopeSummary.BaboonMinReaderVersions
    }
    public static jsonCodec(): ScopeSummary_JsonCodec {
        return ScopeSummary_JsonCodec.instance
    }
}

export class ScopeSummary_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ScopeSummary): unknown {
        if (this !== ScopeSummary_JsonCodec.lazyInstance.value) {
          return ScopeSummary_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "curation": CurationState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.curation),
            "failure": value.failure === undefined ? null : value.failure,
            "rdfGeneration": value.rdfGeneration === undefined ? null : value.rdfGeneration.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ScopeSummary {
        if (this !== ScopeSummary_JsonCodec .lazyInstance.value) {
            return ScopeSummary_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ScopeSummary (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            CurationState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["curation"]),
            obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] as string,
            obj["rdfGeneration"] === undefined || obj["rdfGeneration"] === null ? undefined : obj["rdfGeneration"] === undefined || obj["rdfGeneration"] === null ? undefined : BaboonInt64.read(obj["rdfGeneration"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopeSummary_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopeSummary_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopeSummary'
    public baboonTypeIdentifier() {
        return ScopeSummary_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ScopeSummary_JsonCodec())
    public static get instance(): ScopeSummary_JsonCodec {
        return ScopeSummary_JsonCodec.lazyInstance.value
    }
}