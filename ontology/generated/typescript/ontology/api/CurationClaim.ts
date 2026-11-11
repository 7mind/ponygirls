import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CoordinatorFence, CoordinatorFence_JsonCodec} from './CoordinatorFence.js'
import {CurationAdmissionLimits, CurationAdmissionLimits_JsonCodec} from './CurationAdmissionLimits.js'

export class CurationClaim implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _scope: string;
    private readonly _fence: CoordinatorFence;
    private readonly _baseGeneration: bigint;
    private readonly _frontier: bigint;
    private readonly _previousCoveredFrontier: bigint;
    private readonly _admissionLimits: CurationAdmissionLimits;
    private readonly _profileId: string;
    private readonly _profileDigest: string;
    private readonly _schemaDigest: string;
    private readonly _graphDigest: string;
    private readonly _sourceCutDigest: string;
    private readonly _claimedAt: string;

    constructor(attemptId: string, scope: string, fence: CoordinatorFence, baseGeneration: bigint, frontier: bigint, previousCoveredFrontier: bigint, admissionLimits: CurationAdmissionLimits, profileId: string, profileDigest: string, schemaDigest: string, graphDigest: string, sourceCutDigest: string, claimedAt: string) {
        this._attemptId = attemptId
        this._scope = scope
        this._fence = fence
        this._baseGeneration = baseGeneration
        this._frontier = frontier
        this._previousCoveredFrontier = previousCoveredFrontier
        this._admissionLimits = admissionLimits
        this._profileId = profileId
        this._profileDigest = profileDigest
        this._schemaDigest = schemaDigest
        this._graphDigest = graphDigest
        this._sourceCutDigest = sourceCutDigest
        this._claimedAt = claimedAt
    }

    public get attemptId(): string {
        return this._attemptId;
    }
    public get scope(): string {
        return this._scope;
    }
    public get fence(): CoordinatorFence {
        return this._fence;
    }
    public get baseGeneration(): bigint {
        return this._baseGeneration;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get previousCoveredFrontier(): bigint {
        return this._previousCoveredFrontier;
    }
    public get admissionLimits(): CurationAdmissionLimits {
        return this._admissionLimits;
    }
    public get profileId(): string {
        return this._profileId;
    }
    public get profileDigest(): string {
        return this._profileDigest;
    }
    public get schemaDigest(): string {
        return this._schemaDigest;
    }
    public get graphDigest(): string {
        return this._graphDigest;
    }
    public get sourceCutDigest(): string {
        return this._sourceCutDigest;
    }
    public get claimedAt(): string {
        return this._claimedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            scope: this._scope,
            fence: this._fence,
            baseGeneration: this._baseGeneration,
            frontier: this._frontier,
            previousCoveredFrontier: this._previousCoveredFrontier,
            admissionLimits: this._admissionLimits,
            profileId: this._profileId,
            profileDigest: this._profileDigest,
            schemaDigest: this._schemaDigest,
            graphDigest: this._graphDigest,
            sourceCutDigest: this._sourceCutDigest,
            claimedAt: this._claimedAt
        };
    }

    public with(overrides: {attemptId?: string; scope?: string; fence?: CoordinatorFence; baseGeneration?: bigint; frontier?: bigint; previousCoveredFrontier?: bigint; admissionLimits?: CurationAdmissionLimits; profileId?: string; profileDigest?: string; schemaDigest?: string; graphDigest?: string; sourceCutDigest?: string; claimedAt?: string}): CurationClaim {
        return new CurationClaim(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'scope' in overrides ? overrides.scope! : this._scope,
            'fence' in overrides ? overrides.fence! : this._fence,
            'baseGeneration' in overrides ? overrides.baseGeneration! : this._baseGeneration,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'previousCoveredFrontier' in overrides ? overrides.previousCoveredFrontier! : this._previousCoveredFrontier,
            'admissionLimits' in overrides ? overrides.admissionLimits! : this._admissionLimits,
            'profileId' in overrides ? overrides.profileId! : this._profileId,
            'profileDigest' in overrides ? overrides.profileDigest! : this._profileDigest,
            'schemaDigest' in overrides ? overrides.schemaDigest! : this._schemaDigest,
            'graphDigest' in overrides ? overrides.graphDigest! : this._graphDigest,
            'sourceCutDigest' in overrides ? overrides.sourceCutDigest! : this._sourceCutDigest,
            'claimedAt' in overrides ? overrides.claimedAt! : this._claimedAt
        );
    }

    public static fromPlain(obj: {attemptId: string; scope: string; fence: CoordinatorFence; baseGeneration: bigint; frontier: bigint; previousCoveredFrontier: bigint; admissionLimits: CurationAdmissionLimits; profileId: string; profileDigest: string; schemaDigest: string; graphDigest: string; sourceCutDigest: string; claimedAt: string}): CurationClaim {
        return new CurationClaim(
            obj.attemptId,
            obj.scope,
            obj.fence,
            obj.baseGeneration,
            obj.frontier,
            obj.previousCoveredFrontier,
            obj.admissionLimits,
            obj.profileId,
            obj.profileDigest,
            obj.schemaDigest,
            obj.graphDigest,
            obj.sourceCutDigest,
            obj.claimedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationClaim.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationClaim.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationClaim'
    public baboonTypeIdentifier() {
        return CurationClaim.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationClaim.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationClaim.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationClaim.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationClaim_JsonCodec {
        return CurationClaim_JsonCodec.instance
    }
}

export class CurationClaim_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationClaim): unknown {
        if (this !== CurationClaim_JsonCodec.lazyInstance.value) {
          return CurationClaim_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "scope": value.scope,
            "fence": CoordinatorFence_JsonCodec.instance.encode(BaboonCodecContext.Default, value.fence),
            "baseGeneration": value.baseGeneration.toString(),
            "frontier": value.frontier.toString(),
            "previousCoveredFrontier": value.previousCoveredFrontier.toString(),
            "admissionLimits": CurationAdmissionLimits_JsonCodec.instance.encode(BaboonCodecContext.Default, value.admissionLimits),
            "profileId": value.profileId,
            "profileDigest": value.profileDigest,
            "schemaDigest": value.schemaDigest,
            "graphDigest": value.graphDigest,
            "sourceCutDigest": value.sourceCutDigest,
            "claimedAt": value.claimedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationClaim {
        if (this !== CurationClaim_JsonCodec .lazyInstance.value) {
            return CurationClaim_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationClaim (
            obj["attemptId"] as string,
            obj["scope"] as string,
            CoordinatorFence_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["fence"]),
            BaboonInt64.read(obj["baseGeneration"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["previousCoveredFrontier"], "i64/u64"),
            CurationAdmissionLimits_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["admissionLimits"]),
            obj["profileId"] as string,
            obj["profileDigest"] as string,
            obj["schemaDigest"] as string,
            obj["graphDigest"] as string,
            obj["sourceCutDigest"] as string,
            obj["claimedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationClaim_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationClaim_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationClaim'
    public baboonTypeIdentifier() {
        return CurationClaim_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationClaim_JsonCodec())
    public static get instance(): CurationClaim_JsonCodec {
        return CurationClaim_JsonCodec.lazyInstance.value
    }
}