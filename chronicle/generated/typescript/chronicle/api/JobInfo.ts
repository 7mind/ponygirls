import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {JobState, JobState_JsonCodec} from './JobState.js'

export class JobInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _sessionId: string;
    private readonly _revision: number;
    private readonly _state: JobState;
    private readonly _attempts: number;
    private readonly _error: string | undefined;
    private readonly _completedWindows: number;
    private readonly _totalWindows: number | undefined;

    constructor(id: string, sessionId: string, revision: number, state: JobState, attempts: number, error: string | undefined, completedWindows: number, totalWindows: number | undefined) {
        this._id = id
        this._sessionId = sessionId
        this._revision = revision
        this._state = state
        this._attempts = attempts
        this._error = error
        this._completedWindows = completedWindows
        this._totalWindows = totalWindows
    }

    public get id(): string {
        return this._id;
    }
    public get sessionId(): string {
        return this._sessionId;
    }
    public get revision(): number {
        return this._revision;
    }
    public get state(): JobState {
        return this._state;
    }
    public get attempts(): number {
        return this._attempts;
    }
    public get error(): string | undefined {
        return this._error;
    }
    public get completedWindows(): number {
        return this._completedWindows;
    }
    public get totalWindows(): number | undefined {
        return this._totalWindows;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            sessionId: this._sessionId,
            revision: this._revision,
            state: this._state,
            attempts: this._attempts,
            error: this._error !== undefined ? this._error : undefined,
            completedWindows: this._completedWindows,
            totalWindows: this._totalWindows !== undefined ? this._totalWindows : undefined
        };
    }

    public with(overrides: {id?: string; sessionId?: string; revision?: number; state?: JobState; attempts?: number; error?: string | undefined; completedWindows?: number; totalWindows?: number | undefined}): JobInfo {
        return new JobInfo(
            'id' in overrides ? overrides.id! : this._id,
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'revision' in overrides ? overrides.revision! : this._revision,
            'state' in overrides ? overrides.state! : this._state,
            'attempts' in overrides ? overrides.attempts! : this._attempts,
            'error' in overrides ? overrides.error! : this._error,
            'completedWindows' in overrides ? overrides.completedWindows! : this._completedWindows,
            'totalWindows' in overrides ? overrides.totalWindows! : this._totalWindows
        );
    }

    public static fromPlain(obj: {id: string; sessionId: string; revision: number; state: JobState; attempts: number; error: string | undefined; completedWindows: number; totalWindows: number | undefined}): JobInfo {
        return new JobInfo(
            obj.id,
            obj.sessionId,
            obj.revision,
            obj.state,
            obj.attempts,
            obj.error,
            obj.completedWindows,
            obj.totalWindows
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return JobInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return JobInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#JobInfo'
    public baboonTypeIdentifier() {
        return JobInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return JobInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return JobInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return JobInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): JobInfo_JsonCodec {
        return JobInfo_JsonCodec.instance
    }
}

export class JobInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JobInfo): unknown {
        if (this !== JobInfo_JsonCodec.lazyInstance.value) {
          return JobInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "sessionId": value.sessionId,
            "revision": value.revision,
            "state": JobState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "attempts": value.attempts,
            "error": value.error === undefined ? null : value.error,
            "completedWindows": value.completedWindows,
            "totalWindows": value.totalWindows === undefined ? null : value.totalWindows,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JobInfo {
        if (this !== JobInfo_JsonCodec .lazyInstance.value) {
            return JobInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new JobInfo (
            obj["id"] as string,
            obj["sessionId"] as string,
            obj["revision"] as number,
            JobState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["attempts"] as number,
            obj["error"] === undefined || obj["error"] === null ? undefined : obj["error"] === undefined || obj["error"] === null ? undefined : obj["error"] as string,
            obj["completedWindows"] as number,
            obj["totalWindows"] === undefined || obj["totalWindows"] === null ? undefined : obj["totalWindows"] === undefined || obj["totalWindows"] === null ? undefined : obj["totalWindows"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return JobInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return JobInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#JobInfo'
    public baboonTypeIdentifier() {
        return JobInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JobInfo_JsonCodec())
    public static get instance(): JobInfo_JsonCodec {
        return JobInfo_JsonCodec.lazyInstance.value
    }
}