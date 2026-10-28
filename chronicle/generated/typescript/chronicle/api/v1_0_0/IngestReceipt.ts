import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class IngestReceipt implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _sessionId: string;
    private readonly _revision: number;
    private readonly _jobId: string;

    constructor(requestId: string, sessionId: string, revision: number, jobId: string) {
        this._requestId = requestId
        this._sessionId = sessionId
        this._revision = revision
        this._jobId = jobId
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get sessionId(): string {
        return this._sessionId;
    }
    public get revision(): number {
        return this._revision;
    }
    public get jobId(): string {
        return this._jobId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            sessionId: this._sessionId,
            revision: this._revision,
            jobId: this._jobId
        };
    }

    public with(overrides: {requestId?: string; sessionId?: string; revision?: number; jobId?: string}): IngestReceipt {
        return new IngestReceipt(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'revision' in overrides ? overrides.revision! : this._revision,
            'jobId' in overrides ? overrides.jobId! : this._jobId
        );
    }

    public static fromPlain(obj: {requestId: string; sessionId: string; revision: number; jobId: string}): IngestReceipt {
        return new IngestReceipt(
            obj.requestId,
            obj.sessionId,
            obj.revision,
            obj.jobId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return IngestReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IngestReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IngestReceipt'
    public baboonTypeIdentifier() {
        return IngestReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return IngestReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical", "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return IngestReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return IngestReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): IngestReceipt_JsonCodec {
        return IngestReceipt_JsonCodec.instance
    }
}

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.7.0 */
export class IngestReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IngestReceipt): unknown {
        if (this !== IngestReceipt_JsonCodec.lazyInstance.value) {
          return IngestReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "sessionId": value.sessionId,
            "revision": value.revision,
            "jobId": value.jobId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IngestReceipt {
        if (this !== IngestReceipt_JsonCodec .lazyInstance.value) {
            return IngestReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IngestReceipt (
            obj["requestId"] as string,
            obj["sessionId"] as string,
            obj["revision"] as number,
            obj["jobId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return IngestReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IngestReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IngestReceipt'
    public baboonTypeIdentifier() {
        return IngestReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IngestReceipt_JsonCodec())
    public static get instance(): IngestReceipt_JsonCodec {
        return IngestReceipt_JsonCodec.lazyInstance.value
    }
}