import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationAttemptSummary, CurationAttemptSummary_JsonCodec} from './CurationAttemptSummary.js'

export class CapsuleCut implements BaboonGeneratedLatest {
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _lastPublicationGeneration: bigint | undefined;
    private readonly _attempt: CurationAttemptSummary | undefined;

    constructor(generation: bigint, frontier: bigint, coveredFrontier: bigint, lastPublicationGeneration: bigint | undefined, attempt: CurationAttemptSummary | undefined) {
        this._generation = generation
        this._frontier = frontier
        this._coveredFrontier = coveredFrontier
        this._lastPublicationGeneration = lastPublicationGeneration
        this._attempt = attempt
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
    public get lastPublicationGeneration(): bigint | undefined {
        return this._lastPublicationGeneration;
    }
    public get attempt(): CurationAttemptSummary | undefined {
        return this._attempt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            generation: this._generation,
            frontier: this._frontier,
            coveredFrontier: this._coveredFrontier,
            lastPublicationGeneration: this._lastPublicationGeneration !== undefined ? this._lastPublicationGeneration : undefined,
            attempt: this._attempt !== undefined ? this._attempt : undefined
        };
    }

    public with(overrides: {generation?: bigint; frontier?: bigint; coveredFrontier?: bigint; lastPublicationGeneration?: bigint | undefined; attempt?: CurationAttemptSummary | undefined}): CapsuleCut {
        return new CapsuleCut(
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'lastPublicationGeneration' in overrides ? overrides.lastPublicationGeneration! : this._lastPublicationGeneration,
            'attempt' in overrides ? overrides.attempt! : this._attempt
        );
    }

    public static fromPlain(obj: {generation: bigint; frontier: bigint; coveredFrontier: bigint; lastPublicationGeneration: bigint | undefined; attempt: CurationAttemptSummary | undefined}): CapsuleCut {
        return new CapsuleCut(
            obj.generation,
            obj.frontier,
            obj.coveredFrontier,
            obj.lastPublicationGeneration,
            obj.attempt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleCut.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleCut.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleCut'
    public baboonTypeIdentifier() {
        return CapsuleCut.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleCut.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleCut.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleCut.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleCut_JsonCodec {
        return CapsuleCut_JsonCodec.instance
    }
}

export class CapsuleCut_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleCut): unknown {
        if (this !== CapsuleCut_JsonCodec.lazyInstance.value) {
          return CapsuleCut_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "lastPublicationGeneration": value.lastPublicationGeneration === undefined ? null : value.lastPublicationGeneration.toString(),
            "attempt": value.attempt === undefined ? null : CurationAttemptSummary_JsonCodec.instance.encode(BaboonCodecContext.Default, value.attempt),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleCut {
        if (this !== CapsuleCut_JsonCodec .lazyInstance.value) {
            return CapsuleCut_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleCut (
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            obj["lastPublicationGeneration"] === undefined || obj["lastPublicationGeneration"] === null ? undefined : obj["lastPublicationGeneration"] === undefined || obj["lastPublicationGeneration"] === null ? undefined : BaboonInt64.read(obj["lastPublicationGeneration"], "i64/u64"),
            obj["attempt"] === undefined || obj["attempt"] === null ? undefined : obj["attempt"] === undefined || obj["attempt"] === null ? undefined : CurationAttemptSummary_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["attempt"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleCut_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleCut_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleCut'
    public baboonTypeIdentifier() {
        return CapsuleCut_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleCut_JsonCodec())
    public static get instance(): CapsuleCut_JsonCodec {
        return CapsuleCut_JsonCodec.lazyInstance.value
    }
}