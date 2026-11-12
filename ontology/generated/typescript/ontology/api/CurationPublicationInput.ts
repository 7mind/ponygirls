import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationClaim, CurationClaim_JsonCodec} from './CurationClaim.js'
import {CurationInputManifest, CurationInputManifest_JsonCodec} from './CurationInputManifest.js'
import {CurationProposal, CurationProposal_JsonCodec} from './CurationProposal.js'

export class CurationPublicationInput implements BaboonGeneratedLatest {
    private readonly _claim: CurationClaim;
    private readonly _manifest: CurationInputManifest;
    private readonly _responseOrdinal: number;
    private readonly _responseDigest: string;
    private readonly _proposal: CurationProposal;
    private readonly _proposalDigest: string;
    private readonly _publishedAt: string;

    constructor(claim: CurationClaim, manifest: CurationInputManifest, responseOrdinal: number, responseDigest: string, proposal: CurationProposal, proposalDigest: string, publishedAt: string) {
        this._claim = claim
        this._manifest = manifest
        this._responseOrdinal = responseOrdinal
        this._responseDigest = responseDigest
        this._proposal = proposal
        this._proposalDigest = proposalDigest
        this._publishedAt = publishedAt
    }

    public get claim(): CurationClaim {
        return this._claim;
    }
    public get manifest(): CurationInputManifest {
        return this._manifest;
    }
    public get responseOrdinal(): number {
        return this._responseOrdinal;
    }
    public get responseDigest(): string {
        return this._responseDigest;
    }
    public get proposal(): CurationProposal {
        return this._proposal;
    }
    public get proposalDigest(): string {
        return this._proposalDigest;
    }
    public get publishedAt(): string {
        return this._publishedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            claim: this._claim,
            manifest: this._manifest,
            responseOrdinal: this._responseOrdinal,
            responseDigest: this._responseDigest,
            proposal: this._proposal,
            proposalDigest: this._proposalDigest,
            publishedAt: this._publishedAt
        };
    }

    public with(overrides: {claim?: CurationClaim; manifest?: CurationInputManifest; responseOrdinal?: number; responseDigest?: string; proposal?: CurationProposal; proposalDigest?: string; publishedAt?: string}): CurationPublicationInput {
        return new CurationPublicationInput(
            'claim' in overrides ? overrides.claim! : this._claim,
            'manifest' in overrides ? overrides.manifest! : this._manifest,
            'responseOrdinal' in overrides ? overrides.responseOrdinal! : this._responseOrdinal,
            'responseDigest' in overrides ? overrides.responseDigest! : this._responseDigest,
            'proposal' in overrides ? overrides.proposal! : this._proposal,
            'proposalDigest' in overrides ? overrides.proposalDigest! : this._proposalDigest,
            'publishedAt' in overrides ? overrides.publishedAt! : this._publishedAt
        );
    }

    public static fromPlain(obj: {claim: CurationClaim; manifest: CurationInputManifest; responseOrdinal: number; responseDigest: string; proposal: CurationProposal; proposalDigest: string; publishedAt: string}): CurationPublicationInput {
        return new CurationPublicationInput(
            obj.claim,
            obj.manifest,
            obj.responseOrdinal,
            obj.responseDigest,
            obj.proposal,
            obj.proposalDigest,
            obj.publishedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationPublicationInput.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationPublicationInput.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationPublicationInput'
    public baboonTypeIdentifier() {
        return CurationPublicationInput.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationPublicationInput.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationPublicationInput.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationPublicationInput.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationPublicationInput_JsonCodec {
        return CurationPublicationInput_JsonCodec.instance
    }
}

export class CurationPublicationInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationPublicationInput): unknown {
        if (this !== CurationPublicationInput_JsonCodec.lazyInstance.value) {
          return CurationPublicationInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "claim": CurationClaim_JsonCodec.instance.encode(BaboonCodecContext.Default, value.claim),
            "manifest": CurationInputManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.manifest),
            "responseOrdinal": value.responseOrdinal,
            "responseDigest": value.responseDigest,
            "proposal": CurationProposal_JsonCodec.instance.encode(BaboonCodecContext.Default, value.proposal),
            "proposalDigest": value.proposalDigest,
            "publishedAt": value.publishedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationPublicationInput {
        if (this !== CurationPublicationInput_JsonCodec .lazyInstance.value) {
            return CurationPublicationInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationPublicationInput (
            CurationClaim_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["claim"]),
            CurationInputManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["manifest"]),
            obj["responseOrdinal"] as number,
            obj["responseDigest"] as string,
            CurationProposal_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["proposal"]),
            obj["proposalDigest"] as string,
            obj["publishedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationPublicationInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationPublicationInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationPublicationInput'
    public baboonTypeIdentifier() {
        return CurationPublicationInput_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationPublicationInput_JsonCodec())
    public static get instance(): CurationPublicationInput_JsonCodec {
        return CurationPublicationInput_JsonCodec.lazyInstance.value
    }
}