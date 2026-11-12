import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationProposal, CurationProposal_JsonCodec} from './CurationProposal.js'

export class CurationCandidate implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _inputDigest: string;
    private readonly _responseOrdinal: number;
    private readonly _responseDigest: string;
    private readonly _proposal: CurationProposal;
    private readonly _proposalDigest: string;

    constructor(attemptId: string, inputDigest: string, responseOrdinal: number, responseDigest: string, proposal: CurationProposal, proposalDigest: string) {
        this._attemptId = attemptId
        this._inputDigest = inputDigest
        this._responseOrdinal = responseOrdinal
        this._responseDigest = responseDigest
        this._proposal = proposal
        this._proposalDigest = proposalDigest
    }

    public get attemptId(): string {
        return this._attemptId;
    }
    public get inputDigest(): string {
        return this._inputDigest;
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

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            inputDigest: this._inputDigest,
            responseOrdinal: this._responseOrdinal,
            responseDigest: this._responseDigest,
            proposal: this._proposal,
            proposalDigest: this._proposalDigest
        };
    }

    public with(overrides: {attemptId?: string; inputDigest?: string; responseOrdinal?: number; responseDigest?: string; proposal?: CurationProposal; proposalDigest?: string}): CurationCandidate {
        return new CurationCandidate(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'inputDigest' in overrides ? overrides.inputDigest! : this._inputDigest,
            'responseOrdinal' in overrides ? overrides.responseOrdinal! : this._responseOrdinal,
            'responseDigest' in overrides ? overrides.responseDigest! : this._responseDigest,
            'proposal' in overrides ? overrides.proposal! : this._proposal,
            'proposalDigest' in overrides ? overrides.proposalDigest! : this._proposalDigest
        );
    }

    public static fromPlain(obj: {attemptId: string; inputDigest: string; responseOrdinal: number; responseDigest: string; proposal: CurationProposal; proposalDigest: string}): CurationCandidate {
        return new CurationCandidate(
            obj.attemptId,
            obj.inputDigest,
            obj.responseOrdinal,
            obj.responseDigest,
            obj.proposal,
            obj.proposalDigest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationCandidate.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationCandidate.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationCandidate'
    public baboonTypeIdentifier() {
        return CurationCandidate.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationCandidate.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationCandidate.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationCandidate.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationCandidate_JsonCodec {
        return CurationCandidate_JsonCodec.instance
    }
}

export class CurationCandidate_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationCandidate): unknown {
        if (this !== CurationCandidate_JsonCodec.lazyInstance.value) {
          return CurationCandidate_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "inputDigest": value.inputDigest,
            "responseOrdinal": value.responseOrdinal,
            "responseDigest": value.responseDigest,
            "proposal": CurationProposal_JsonCodec.instance.encode(BaboonCodecContext.Default, value.proposal),
            "proposalDigest": value.proposalDigest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationCandidate {
        if (this !== CurationCandidate_JsonCodec .lazyInstance.value) {
            return CurationCandidate_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationCandidate (
            obj["attemptId"] as string,
            obj["inputDigest"] as string,
            obj["responseOrdinal"] as number,
            obj["responseDigest"] as string,
            CurationProposal_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["proposal"]),
            obj["proposalDigest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationCandidate_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationCandidate_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationCandidate'
    public baboonTypeIdentifier() {
        return CurationCandidate_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationCandidate_JsonCodec())
    public static get instance(): CurationCandidate_JsonCodec {
        return CurationCandidate_JsonCodec.lazyInstance.value
    }
}