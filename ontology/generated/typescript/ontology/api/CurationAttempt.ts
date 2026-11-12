import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationAttemptState, CurationAttemptState_JsonCodec} from './CurationAttemptState.js'
import {CurationCandidate, CurationCandidate_JsonCodec} from './CurationCandidate.js'
import {CurationClaim, CurationClaim_JsonCodec} from './CurationClaim.js'
import {CurationInputManifest, CurationInputManifest_JsonCodec} from './CurationInputManifest.js'
import {CurationPublicationReceipt, CurationPublicationReceipt_JsonCodec} from './CurationPublicationReceipt.js'

export class CurationAttempt implements BaboonGeneratedLatest {
    private readonly _claim: CurationClaim;
    private readonly _state: CurationAttemptState;
    private readonly _inputManifest: CurationInputManifest | undefined;
    private readonly _candidate: CurationCandidate | undefined;
    private readonly _publication: CurationPublicationReceipt | undefined;
    private readonly _terminalCode: string | undefined;
    private readonly _auditUncertain: boolean;
    private readonly _finishedAt: string | undefined;

    constructor(claim: CurationClaim, state: CurationAttemptState, inputManifest: CurationInputManifest | undefined, candidate: CurationCandidate | undefined, publication: CurationPublicationReceipt | undefined, terminalCode: string | undefined, auditUncertain: boolean, finishedAt: string | undefined) {
        this._claim = claim
        this._state = state
        this._inputManifest = inputManifest
        this._candidate = candidate
        this._publication = publication
        this._terminalCode = terminalCode
        this._auditUncertain = auditUncertain
        this._finishedAt = finishedAt
    }

    public get claim(): CurationClaim {
        return this._claim;
    }
    public get state(): CurationAttemptState {
        return this._state;
    }
    public get inputManifest(): CurationInputManifest | undefined {
        return this._inputManifest;
    }
    public get candidate(): CurationCandidate | undefined {
        return this._candidate;
    }
    public get publication(): CurationPublicationReceipt | undefined {
        return this._publication;
    }
    public get terminalCode(): string | undefined {
        return this._terminalCode;
    }
    public get auditUncertain(): boolean {
        return this._auditUncertain;
    }
    public get finishedAt(): string | undefined {
        return this._finishedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            claim: this._claim,
            state: this._state,
            inputManifest: this._inputManifest !== undefined ? this._inputManifest : undefined,
            candidate: this._candidate !== undefined ? this._candidate : undefined,
            publication: this._publication !== undefined ? this._publication : undefined,
            terminalCode: this._terminalCode !== undefined ? this._terminalCode : undefined,
            auditUncertain: this._auditUncertain,
            finishedAt: this._finishedAt !== undefined ? this._finishedAt : undefined
        };
    }

    public with(overrides: {claim?: CurationClaim; state?: CurationAttemptState; inputManifest?: CurationInputManifest | undefined; candidate?: CurationCandidate | undefined; publication?: CurationPublicationReceipt | undefined; terminalCode?: string | undefined; auditUncertain?: boolean; finishedAt?: string | undefined}): CurationAttempt {
        return new CurationAttempt(
            'claim' in overrides ? overrides.claim! : this._claim,
            'state' in overrides ? overrides.state! : this._state,
            'inputManifest' in overrides ? overrides.inputManifest! : this._inputManifest,
            'candidate' in overrides ? overrides.candidate! : this._candidate,
            'publication' in overrides ? overrides.publication! : this._publication,
            'terminalCode' in overrides ? overrides.terminalCode! : this._terminalCode,
            'auditUncertain' in overrides ? overrides.auditUncertain! : this._auditUncertain,
            'finishedAt' in overrides ? overrides.finishedAt! : this._finishedAt
        );
    }

    public static fromPlain(obj: {claim: CurationClaim; state: CurationAttemptState; inputManifest: CurationInputManifest | undefined; candidate: CurationCandidate | undefined; publication: CurationPublicationReceipt | undefined; terminalCode: string | undefined; auditUncertain: boolean; finishedAt: string | undefined}): CurationAttempt {
        return new CurationAttempt(
            obj.claim,
            obj.state,
            obj.inputManifest,
            obj.candidate,
            obj.publication,
            obj.terminalCode,
            obj.auditUncertain,
            obj.finishedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAttempt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAttempt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAttempt'
    public baboonTypeIdentifier() {
        return CurationAttempt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationAttempt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationAttempt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationAttempt.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationAttempt_JsonCodec {
        return CurationAttempt_JsonCodec.instance
    }
}

export class CurationAttempt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAttempt): unknown {
        if (this !== CurationAttempt_JsonCodec.lazyInstance.value) {
          return CurationAttempt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "claim": CurationClaim_JsonCodec.instance.encode(BaboonCodecContext.Default, value.claim),
            "state": CurationAttemptState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "inputManifest": value.inputManifest === undefined ? null : CurationInputManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.inputManifest),
            "candidate": value.candidate === undefined ? null : CurationCandidate_JsonCodec.instance.encode(BaboonCodecContext.Default, value.candidate),
            "publication": value.publication === undefined ? null : CurationPublicationReceipt_JsonCodec.instance.encode(BaboonCodecContext.Default, value.publication),
            "terminalCode": value.terminalCode === undefined ? null : value.terminalCode,
            "auditUncertain": value.auditUncertain,
            "finishedAt": value.finishedAt === undefined ? null : value.finishedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAttempt {
        if (this !== CurationAttempt_JsonCodec .lazyInstance.value) {
            return CurationAttempt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationAttempt (
            CurationClaim_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["claim"]),
            CurationAttemptState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["inputManifest"] === undefined || obj["inputManifest"] === null ? undefined : obj["inputManifest"] === undefined || obj["inputManifest"] === null ? undefined : CurationInputManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["inputManifest"]),
            obj["candidate"] === undefined || obj["candidate"] === null ? undefined : obj["candidate"] === undefined || obj["candidate"] === null ? undefined : CurationCandidate_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["candidate"]),
            obj["publication"] === undefined || obj["publication"] === null ? undefined : obj["publication"] === undefined || obj["publication"] === null ? undefined : CurationPublicationReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["publication"]),
            obj["terminalCode"] === undefined || obj["terminalCode"] === null ? undefined : obj["terminalCode"] === undefined || obj["terminalCode"] === null ? undefined : obj["terminalCode"] as string,
            obj["auditUncertain"] as boolean,
            obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAttempt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAttempt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAttempt'
    public baboonTypeIdentifier() {
        return CurationAttempt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAttempt_JsonCodec())
    public static get instance(): CurationAttempt_JsonCodec {
        return CurationAttempt_JsonCodec.lazyInstance.value
    }
}