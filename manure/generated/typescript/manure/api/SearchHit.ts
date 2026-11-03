import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Artifact, Artifact_JsonCodec} from './Artifact.js'
import {SearchEvidence, SearchEvidence_JsonCodec} from './SearchEvidence.js'

export class SearchHit implements BaboonGeneratedLatest {
    private readonly _artifact: Artifact;
    private readonly _sourceVersion: string;
    private readonly _generationId: string;
    private readonly _policyId: string;
    private readonly _embeddingProfile: string | undefined;
    private readonly _evidence: Array<SearchEvidence>;
    private readonly _score: number;

    constructor(artifact: Artifact, sourceVersion: string, generationId: string, policyId: string, embeddingProfile: string | undefined, evidence: Array<SearchEvidence>, score: number) {
        this._artifact = artifact
        this._sourceVersion = sourceVersion
        this._generationId = generationId
        this._policyId = policyId
        this._embeddingProfile = embeddingProfile
        this._evidence = evidence
        this._score = score
    }

    public get artifact(): Artifact {
        return this._artifact;
    }
    public get sourceVersion(): string {
        return this._sourceVersion;
    }
    public get generationId(): string {
        return this._generationId;
    }
    public get policyId(): string {
        return this._policyId;
    }
    public get embeddingProfile(): string | undefined {
        return this._embeddingProfile;
    }
    public get evidence(): Array<SearchEvidence> {
        return this._evidence;
    }
    public get score(): number {
        return this._score;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifact: this._artifact,
            sourceVersion: this._sourceVersion,
            generationId: this._generationId,
            policyId: this._policyId,
            embeddingProfile: this._embeddingProfile !== undefined ? this._embeddingProfile : undefined,
            evidence: this._evidence,
            score: this._score
        };
    }

    public with(overrides: {artifact?: Artifact; sourceVersion?: string; generationId?: string; policyId?: string; embeddingProfile?: string | undefined; evidence?: Array<SearchEvidence>; score?: number}): SearchHit {
        return new SearchHit(
            'artifact' in overrides ? overrides.artifact! : this._artifact,
            'sourceVersion' in overrides ? overrides.sourceVersion! : this._sourceVersion,
            'generationId' in overrides ? overrides.generationId! : this._generationId,
            'policyId' in overrides ? overrides.policyId! : this._policyId,
            'embeddingProfile' in overrides ? overrides.embeddingProfile! : this._embeddingProfile,
            'evidence' in overrides ? overrides.evidence! : this._evidence,
            'score' in overrides ? overrides.score! : this._score
        );
    }

    public static fromPlain(obj: {artifact: Artifact; sourceVersion: string; generationId: string; policyId: string; embeddingProfile: string | undefined; evidence: Array<SearchEvidence>; score: number}): SearchHit {
        return new SearchHit(
            obj.artifact,
            obj.sourceVersion,
            obj.generationId,
            obj.policyId,
            obj.embeddingProfile,
            obj.evidence,
            obj.score
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchHit.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchHit.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchHit.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchHit.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchHit.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.instance
    }
}

export class SearchHit_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchHit): unknown {
        if (this !== SearchHit_JsonCodec.lazyInstance.value) {
          return SearchHit_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
            "sourceVersion": value.sourceVersion,
            "generationId": value.generationId,
            "policyId": value.policyId,
            "embeddingProfile": value.embeddingProfile === undefined ? null : value.embeddingProfile,
            "evidence": Array.from(value.evidence).map(item => SearchEvidence_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "score": value.score,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchHit {
        if (this !== SearchHit_JsonCodec .lazyInstance.value) {
            return SearchHit_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchHit (
            Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]),
            obj["sourceVersion"] as string,
            obj["generationId"] as string,
            obj["policyId"] as string,
            obj["embeddingProfile"] === undefined || obj["embeddingProfile"] === null ? undefined : obj["embeddingProfile"] === undefined || obj["embeddingProfile"] === null ? undefined : obj["embeddingProfile"] as string,
            (obj["evidence"] as unknown[]).map(item => SearchEvidence_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["score"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchHit_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchHit_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchHit_JsonCodec())
    public static get instance(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.lazyInstance.value
    }
}