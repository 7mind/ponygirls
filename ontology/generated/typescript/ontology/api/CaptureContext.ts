import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {LineageStatus, LineageStatus_JsonCodec} from './LineageStatus.js'

export class CaptureContext implements BaboonGeneratedLatest {
    private readonly _sessionId: string;
    private readonly _rootSessionId: string | undefined;
    private readonly _parentSessionId: string | undefined;
    private readonly _lineage: LineageStatus;
    private readonly _branch: string;
    private readonly _epoch: string;

    constructor(sessionId: string, rootSessionId: string | undefined, parentSessionId: string | undefined, lineage: LineageStatus, branch: string, epoch: string) {
        this._sessionId = sessionId
        this._rootSessionId = rootSessionId
        this._parentSessionId = parentSessionId
        this._lineage = lineage
        this._branch = branch
        this._epoch = epoch
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get rootSessionId(): string | undefined {
        return this._rootSessionId;
    }
    public get parentSessionId(): string | undefined {
        return this._parentSessionId;
    }
    public get lineage(): LineageStatus {
        return this._lineage;
    }
    public get branch(): string {
        return this._branch;
    }
    public get epoch(): string {
        return this._epoch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            rootSessionId: this._rootSessionId !== undefined ? this._rootSessionId : undefined,
            parentSessionId: this._parentSessionId !== undefined ? this._parentSessionId : undefined,
            lineage: this._lineage,
            branch: this._branch,
            epoch: this._epoch
        };
    }

    public with(overrides: {sessionId?: string; rootSessionId?: string | undefined; parentSessionId?: string | undefined; lineage?: LineageStatus; branch?: string; epoch?: string}): CaptureContext {
        return new CaptureContext(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'rootSessionId' in overrides ? overrides.rootSessionId! : this._rootSessionId,
            'parentSessionId' in overrides ? overrides.parentSessionId! : this._parentSessionId,
            'lineage' in overrides ? overrides.lineage! : this._lineage,
            'branch' in overrides ? overrides.branch! : this._branch,
            'epoch' in overrides ? overrides.epoch! : this._epoch
        );
    }

    public static fromPlain(obj: {sessionId: string; rootSessionId: string | undefined; parentSessionId: string | undefined; lineage: LineageStatus; branch: string; epoch: string}): CaptureContext {
        return new CaptureContext(
            obj.sessionId,
            obj.rootSessionId,
            obj.parentSessionId,
            obj.lineage,
            obj.branch,
            obj.epoch
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CaptureContext.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CaptureContext.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CaptureContext'
    public baboonTypeIdentifier() {
        return CaptureContext.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CaptureContext.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CaptureContext.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CaptureContext.BaboonMinReaderVersions
    }
    public static jsonCodec(): CaptureContext_JsonCodec {
        return CaptureContext_JsonCodec.instance
    }
}

export class CaptureContext_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CaptureContext): unknown {
        if (this !== CaptureContext_JsonCodec.lazyInstance.value) {
          return CaptureContext_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "rootSessionId": value.rootSessionId === undefined ? null : value.rootSessionId,
            "parentSessionId": value.parentSessionId === undefined ? null : value.parentSessionId,
            "lineage": LineageStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value.lineage),
            "branch": value.branch,
            "epoch": value.epoch,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CaptureContext {
        if (this !== CaptureContext_JsonCodec .lazyInstance.value) {
            return CaptureContext_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CaptureContext (
            obj["sessionId"] as string,
            obj["rootSessionId"] === undefined || obj["rootSessionId"] === null ? undefined : obj["rootSessionId"] === undefined || obj["rootSessionId"] === null ? undefined : obj["rootSessionId"] as string,
            obj["parentSessionId"] === undefined || obj["parentSessionId"] === null ? undefined : obj["parentSessionId"] === undefined || obj["parentSessionId"] === null ? undefined : obj["parentSessionId"] as string,
            LineageStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["lineage"]),
            obj["branch"] as string,
            obj["epoch"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CaptureContext_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CaptureContext_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CaptureContext'
    public baboonTypeIdentifier() {
        return CaptureContext_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CaptureContext_JsonCodec())
    public static get instance(): CaptureContext_JsonCodec {
        return CaptureContext_JsonCodec.lazyInstance.value
    }
}