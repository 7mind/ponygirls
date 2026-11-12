import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationAttemptState, CurationAttemptState_JsonCodec} from './CurationAttemptState.js'
import {CurationAuditStage, CurationAuditStage_JsonCodec} from './CurationAuditStage.js'

export class CurationAttemptSummary implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _baseGeneration: bigint;
    private readonly _frontier: bigint;
    private readonly _previousCoveredFrontier: bigint;
    private readonly _state: CurationAttemptState;
    private readonly _inputDigest: string | undefined;
    private readonly _lastOrdinal: number | undefined;
    private readonly _lastStage: CurationAuditStage | undefined;
    private readonly _terminalCode: string | undefined;
    private readonly _auditUncertain: boolean;
    private readonly _claimedAt: string;
    private readonly _deadlineAt: string;
    private readonly _finishedAt: string | undefined;

    constructor(attemptId: string, baseGeneration: bigint, frontier: bigint, previousCoveredFrontier: bigint, state: CurationAttemptState, inputDigest: string | undefined, lastOrdinal: number | undefined, lastStage: CurationAuditStage | undefined, terminalCode: string | undefined, auditUncertain: boolean, claimedAt: string, deadlineAt: string, finishedAt: string | undefined) {
        this._attemptId = attemptId
        this._baseGeneration = baseGeneration
        this._frontier = frontier
        this._previousCoveredFrontier = previousCoveredFrontier
        this._state = state
        this._inputDigest = inputDigest
        this._lastOrdinal = lastOrdinal
        this._lastStage = lastStage
        this._terminalCode = terminalCode
        this._auditUncertain = auditUncertain
        this._claimedAt = claimedAt
        this._deadlineAt = deadlineAt
        this._finishedAt = finishedAt
    }

    public get attemptId(): string {
        return this._attemptId;
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
    public get state(): CurationAttemptState {
        return this._state;
    }
    public get inputDigest(): string | undefined {
        return this._inputDigest;
    }
    public get lastOrdinal(): number | undefined {
        return this._lastOrdinal;
    }
    public get lastStage(): CurationAuditStage | undefined {
        return this._lastStage;
    }
    public get terminalCode(): string | undefined {
        return this._terminalCode;
    }
    public get auditUncertain(): boolean {
        return this._auditUncertain;
    }
    public get claimedAt(): string {
        return this._claimedAt;
    }
    public get deadlineAt(): string {
        return this._deadlineAt;
    }
    public get finishedAt(): string | undefined {
        return this._finishedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            baseGeneration: this._baseGeneration,
            frontier: this._frontier,
            previousCoveredFrontier: this._previousCoveredFrontier,
            state: this._state,
            inputDigest: this._inputDigest !== undefined ? this._inputDigest : undefined,
            lastOrdinal: this._lastOrdinal !== undefined ? this._lastOrdinal : undefined,
            lastStage: this._lastStage !== undefined ? this._lastStage : undefined,
            terminalCode: this._terminalCode !== undefined ? this._terminalCode : undefined,
            auditUncertain: this._auditUncertain,
            claimedAt: this._claimedAt,
            deadlineAt: this._deadlineAt,
            finishedAt: this._finishedAt !== undefined ? this._finishedAt : undefined
        };
    }

    public with(overrides: {attemptId?: string; baseGeneration?: bigint; frontier?: bigint; previousCoveredFrontier?: bigint; state?: CurationAttemptState; inputDigest?: string | undefined; lastOrdinal?: number | undefined; lastStage?: CurationAuditStage | undefined; terminalCode?: string | undefined; auditUncertain?: boolean; claimedAt?: string; deadlineAt?: string; finishedAt?: string | undefined}): CurationAttemptSummary {
        return new CurationAttemptSummary(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'baseGeneration' in overrides ? overrides.baseGeneration! : this._baseGeneration,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'previousCoveredFrontier' in overrides ? overrides.previousCoveredFrontier! : this._previousCoveredFrontier,
            'state' in overrides ? overrides.state! : this._state,
            'inputDigest' in overrides ? overrides.inputDigest! : this._inputDigest,
            'lastOrdinal' in overrides ? overrides.lastOrdinal! : this._lastOrdinal,
            'lastStage' in overrides ? overrides.lastStage! : this._lastStage,
            'terminalCode' in overrides ? overrides.terminalCode! : this._terminalCode,
            'auditUncertain' in overrides ? overrides.auditUncertain! : this._auditUncertain,
            'claimedAt' in overrides ? overrides.claimedAt! : this._claimedAt,
            'deadlineAt' in overrides ? overrides.deadlineAt! : this._deadlineAt,
            'finishedAt' in overrides ? overrides.finishedAt! : this._finishedAt
        );
    }

    public static fromPlain(obj: {attemptId: string; baseGeneration: bigint; frontier: bigint; previousCoveredFrontier: bigint; state: CurationAttemptState; inputDigest: string | undefined; lastOrdinal: number | undefined; lastStage: CurationAuditStage | undefined; terminalCode: string | undefined; auditUncertain: boolean; claimedAt: string; deadlineAt: string; finishedAt: string | undefined}): CurationAttemptSummary {
        return new CurationAttemptSummary(
            obj.attemptId,
            obj.baseGeneration,
            obj.frontier,
            obj.previousCoveredFrontier,
            obj.state,
            obj.inputDigest,
            obj.lastOrdinal,
            obj.lastStage,
            obj.terminalCode,
            obj.auditUncertain,
            obj.claimedAt,
            obj.deadlineAt,
            obj.finishedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAttemptSummary.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAttemptSummary.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAttemptSummary'
    public baboonTypeIdentifier() {
        return CurationAttemptSummary.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationAttemptSummary.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationAttemptSummary.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationAttemptSummary.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationAttemptSummary_JsonCodec {
        return CurationAttemptSummary_JsonCodec.instance
    }
}

export class CurationAttemptSummary_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAttemptSummary): unknown {
        if (this !== CurationAttemptSummary_JsonCodec.lazyInstance.value) {
          return CurationAttemptSummary_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "baseGeneration": value.baseGeneration.toString(),
            "frontier": value.frontier.toString(),
            "previousCoveredFrontier": value.previousCoveredFrontier.toString(),
            "state": CurationAttemptState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "inputDigest": value.inputDigest === undefined ? null : value.inputDigest,
            "lastOrdinal": value.lastOrdinal === undefined ? null : value.lastOrdinal,
            "lastStage": value.lastStage === undefined ? null : CurationAuditStage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.lastStage),
            "terminalCode": value.terminalCode === undefined ? null : value.terminalCode,
            "auditUncertain": value.auditUncertain,
            "claimedAt": value.claimedAt,
            "deadlineAt": value.deadlineAt,
            "finishedAt": value.finishedAt === undefined ? null : value.finishedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAttemptSummary {
        if (this !== CurationAttemptSummary_JsonCodec .lazyInstance.value) {
            return CurationAttemptSummary_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationAttemptSummary (
            obj["attemptId"] as string,
            BaboonInt64.read(obj["baseGeneration"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["previousCoveredFrontier"], "i64/u64"),
            CurationAttemptState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["inputDigest"] === undefined || obj["inputDigest"] === null ? undefined : obj["inputDigest"] === undefined || obj["inputDigest"] === null ? undefined : obj["inputDigest"] as string,
            obj["lastOrdinal"] === undefined || obj["lastOrdinal"] === null ? undefined : obj["lastOrdinal"] === undefined || obj["lastOrdinal"] === null ? undefined : obj["lastOrdinal"] as number,
            obj["lastStage"] === undefined || obj["lastStage"] === null ? undefined : obj["lastStage"] === undefined || obj["lastStage"] === null ? undefined : CurationAuditStage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["lastStage"]),
            obj["terminalCode"] === undefined || obj["terminalCode"] === null ? undefined : obj["terminalCode"] === undefined || obj["terminalCode"] === null ? undefined : obj["terminalCode"] as string,
            obj["auditUncertain"] as boolean,
            obj["claimedAt"] as string,
            obj["deadlineAt"] as string,
            obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAttemptSummary_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAttemptSummary_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAttemptSummary'
    public baboonTypeIdentifier() {
        return CurationAttemptSummary_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAttemptSummary_JsonCodec())
    public static get instance(): CurationAttemptSummary_JsonCodec {
        return CurationAttemptSummary_JsonCodec.lazyInstance.value
    }
}