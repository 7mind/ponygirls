import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RunState, RunState_JsonCodec} from './RunState.js'
import {RunTrigger, RunTrigger_JsonCodec} from './RunTrigger.js'

export class RunInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _repositoryId: string;
    private readonly _riteId: string;
    private readonly _trigger: RunTrigger;
    private readonly _scheduledFor: string;
    private readonly _createdAt: string;
    private readonly _startedAt: string | undefined;
    private readonly _finishedAt: string | undefined;
    private readonly _state: RunState;
    private readonly _failureCode: string | undefined;
    private readonly _baseRevision: string | undefined;
    private readonly _promptDigest: string | undefined;
    private readonly _branch: string | undefined;
    private readonly _proposalUrl: string | undefined;

    constructor(id: string, repositoryId: string, riteId: string, trigger: RunTrigger, scheduledFor: string, createdAt: string, startedAt: string | undefined, finishedAt: string | undefined, state: RunState, failureCode: string | undefined, baseRevision: string | undefined, promptDigest: string | undefined, branch: string | undefined, proposalUrl: string | undefined) {
        this._id = id
        this._repositoryId = repositoryId
        this._riteId = riteId
        this._trigger = trigger
        this._scheduledFor = scheduledFor
        this._createdAt = createdAt
        this._startedAt = startedAt
        this._finishedAt = finishedAt
        this._state = state
        this._failureCode = failureCode
        this._baseRevision = baseRevision
        this._promptDigest = promptDigest
        this._branch = branch
        this._proposalUrl = proposalUrl
    }

    public get id(): string {
        return this._id;
    }
    public get repositoryId(): string {
        return this._repositoryId;
    }
    public get riteId(): string {
        return this._riteId;
    }
    public get trigger(): RunTrigger {
        return this._trigger;
    }
    public get scheduledFor(): string {
        return this._scheduledFor;
    }
    public get createdAt(): string {
        return this._createdAt;
    }
    public get startedAt(): string | undefined {
        return this._startedAt;
    }
    public get finishedAt(): string | undefined {
        return this._finishedAt;
    }
    public get state(): RunState {
        return this._state;
    }
    public get failureCode(): string | undefined {
        return this._failureCode;
    }
    public get baseRevision(): string | undefined {
        return this._baseRevision;
    }
    public get promptDigest(): string | undefined {
        return this._promptDigest;
    }
    public get branch(): string | undefined {
        return this._branch;
    }
    public get proposalUrl(): string | undefined {
        return this._proposalUrl;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            repositoryId: this._repositoryId,
            riteId: this._riteId,
            trigger: this._trigger,
            scheduledFor: this._scheduledFor,
            createdAt: this._createdAt,
            startedAt: this._startedAt !== undefined ? this._startedAt : undefined,
            finishedAt: this._finishedAt !== undefined ? this._finishedAt : undefined,
            state: this._state,
            failureCode: this._failureCode !== undefined ? this._failureCode : undefined,
            baseRevision: this._baseRevision !== undefined ? this._baseRevision : undefined,
            promptDigest: this._promptDigest !== undefined ? this._promptDigest : undefined,
            branch: this._branch !== undefined ? this._branch : undefined,
            proposalUrl: this._proposalUrl !== undefined ? this._proposalUrl : undefined
        };
    }

    public with(overrides: {id?: string; repositoryId?: string; riteId?: string; trigger?: RunTrigger; scheduledFor?: string; createdAt?: string; startedAt?: string | undefined; finishedAt?: string | undefined; state?: RunState; failureCode?: string | undefined; baseRevision?: string | undefined; promptDigest?: string | undefined; branch?: string | undefined; proposalUrl?: string | undefined}): RunInfo {
        return new RunInfo(
            'id' in overrides ? overrides.id! : this._id,
            'repositoryId' in overrides ? overrides.repositoryId! : this._repositoryId,
            'riteId' in overrides ? overrides.riteId! : this._riteId,
            'trigger' in overrides ? overrides.trigger! : this._trigger,
            'scheduledFor' in overrides ? overrides.scheduledFor! : this._scheduledFor,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'startedAt' in overrides ? overrides.startedAt! : this._startedAt,
            'finishedAt' in overrides ? overrides.finishedAt! : this._finishedAt,
            'state' in overrides ? overrides.state! : this._state,
            'failureCode' in overrides ? overrides.failureCode! : this._failureCode,
            'baseRevision' in overrides ? overrides.baseRevision! : this._baseRevision,
            'promptDigest' in overrides ? overrides.promptDigest! : this._promptDigest,
            'branch' in overrides ? overrides.branch! : this._branch,
            'proposalUrl' in overrides ? overrides.proposalUrl! : this._proposalUrl
        );
    }

    public static fromPlain(obj: {id: string; repositoryId: string; riteId: string; trigger: RunTrigger; scheduledFor: string; createdAt: string; startedAt: string | undefined; finishedAt: string | undefined; state: RunState; failureCode: string | undefined; baseRevision: string | undefined; promptDigest: string | undefined; branch: string | undefined; proposalUrl: string | undefined}): RunInfo {
        return new RunInfo(
            obj.id,
            obj.repositoryId,
            obj.riteId,
            obj.trigger,
            obj.scheduledFor,
            obj.createdAt,
            obj.startedAt,
            obj.finishedAt,
            obj.state,
            obj.failureCode,
            obj.baseRevision,
            obj.promptDigest,
            obj.branch,
            obj.proposalUrl
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunInfo'
    public baboonTypeIdentifier() {
        return RunInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RunInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RunInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RunInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): RunInfo_JsonCodec {
        return RunInfo_JsonCodec.instance
    }
}

export class RunInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunInfo): unknown {
        if (this !== RunInfo_JsonCodec.lazyInstance.value) {
          return RunInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "repositoryId": value.repositoryId,
            "riteId": value.riteId,
            "trigger": RunTrigger_JsonCodec.instance.encode(BaboonCodecContext.Default, value.trigger),
            "scheduledFor": value.scheduledFor,
            "createdAt": value.createdAt,
            "startedAt": value.startedAt === undefined ? null : value.startedAt,
            "finishedAt": value.finishedAt === undefined ? null : value.finishedAt,
            "state": RunState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "failureCode": value.failureCode === undefined ? null : value.failureCode,
            "baseRevision": value.baseRevision === undefined ? null : value.baseRevision,
            "promptDigest": value.promptDigest === undefined ? null : value.promptDigest,
            "branch": value.branch === undefined ? null : value.branch,
            "proposalUrl": value.proposalUrl === undefined ? null : value.proposalUrl,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunInfo {
        if (this !== RunInfo_JsonCodec .lazyInstance.value) {
            return RunInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RunInfo (
            obj["id"] as string,
            obj["repositoryId"] as string,
            obj["riteId"] as string,
            RunTrigger_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["trigger"]),
            obj["scheduledFor"] as string,
            obj["createdAt"] as string,
            obj["startedAt"] === undefined || obj["startedAt"] === null ? undefined : obj["startedAt"] === undefined || obj["startedAt"] === null ? undefined : obj["startedAt"] as string,
            obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] === undefined || obj["finishedAt"] === null ? undefined : obj["finishedAt"] as string,
            RunState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["failureCode"] === undefined || obj["failureCode"] === null ? undefined : obj["failureCode"] === undefined || obj["failureCode"] === null ? undefined : obj["failureCode"] as string,
            obj["baseRevision"] === undefined || obj["baseRevision"] === null ? undefined : obj["baseRevision"] === undefined || obj["baseRevision"] === null ? undefined : obj["baseRevision"] as string,
            obj["promptDigest"] === undefined || obj["promptDigest"] === null ? undefined : obj["promptDigest"] === undefined || obj["promptDigest"] === null ? undefined : obj["promptDigest"] as string,
            obj["branch"] === undefined || obj["branch"] === null ? undefined : obj["branch"] === undefined || obj["branch"] === null ? undefined : obj["branch"] as string,
            obj["proposalUrl"] === undefined || obj["proposalUrl"] === null ? undefined : obj["proposalUrl"] === undefined || obj["proposalUrl"] === null ? undefined : obj["proposalUrl"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunInfo'
    public baboonTypeIdentifier() {
        return RunInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunInfo_JsonCodec())
    public static get instance(): RunInfo_JsonCodec {
        return RunInfo_JsonCodec.lazyInstance.value
    }
}