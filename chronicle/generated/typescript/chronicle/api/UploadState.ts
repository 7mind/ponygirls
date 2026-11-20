import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {IngestReceipt, IngestReceipt_JsonCodec} from './IngestReceipt.js'
import {UploadLimits, UploadLimits_JsonCodec} from './UploadLimits.js'
import {UploadPhase, UploadPhase_JsonCodec} from './UploadPhase.js'

export class UploadState implements BaboonGeneratedLatest {
    private readonly _uploadId: string;
    private readonly _requestId: string;
    private readonly _phase: UploadPhase;
    private readonly _append: boolean;
    private readonly _receivedParts: number;
    private readonly _receivedRawBytes: bigint;
    private readonly _receivedMessages: number;
    private readonly _lastPartSha256: string | undefined;
    private readonly _expiresInSeconds: number;
    private readonly _limits: UploadLimits;
    private readonly _receipt: IngestReceipt | undefined;
    private readonly _failure: string | undefined;

    constructor(uploadId: string, requestId: string, phase: UploadPhase, append: boolean, receivedParts: number, receivedRawBytes: bigint, receivedMessages: number, lastPartSha256: string | undefined, expiresInSeconds: number, limits: UploadLimits, receipt: IngestReceipt | undefined, failure: string | undefined) {
        this._uploadId = uploadId
        this._requestId = requestId
        this._phase = phase
        this._append = append
        this._receivedParts = receivedParts
        this._receivedRawBytes = receivedRawBytes
        this._receivedMessages = receivedMessages
        this._lastPartSha256 = lastPartSha256
        this._expiresInSeconds = expiresInSeconds
        this._limits = limits
        this._receipt = receipt
        this._failure = failure
    }

    public get uploadId(): string {
        return this._uploadId;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get phase(): UploadPhase {
        return this._phase;
    }
    public get append(): boolean {
        return this._append;
    }
    public get receivedParts(): number {
        return this._receivedParts;
    }
    public get receivedRawBytes(): bigint {
        return this._receivedRawBytes;
    }
    public get receivedMessages(): number {
        return this._receivedMessages;
    }
    public get lastPartSha256(): string | undefined {
        return this._lastPartSha256;
    }
    public get expiresInSeconds(): number {
        return this._expiresInSeconds;
    }
    public get limits(): UploadLimits {
        return this._limits;
    }
    public get receipt(): IngestReceipt | undefined {
        return this._receipt;
    }
    public get failure(): string | undefined {
        return this._failure;
    }

    public toJSON(): Record<string, unknown> {
        return {
            uploadId: this._uploadId,
            requestId: this._requestId,
            phase: this._phase,
            append: this._append,
            receivedParts: this._receivedParts,
            receivedRawBytes: this._receivedRawBytes,
            receivedMessages: this._receivedMessages,
            lastPartSha256: this._lastPartSha256 !== undefined ? this._lastPartSha256 : undefined,
            expiresInSeconds: this._expiresInSeconds,
            limits: this._limits,
            receipt: this._receipt !== undefined ? this._receipt : undefined,
            failure: this._failure !== undefined ? this._failure : undefined
        };
    }

    public with(overrides: {uploadId?: string; requestId?: string; phase?: UploadPhase; append?: boolean; receivedParts?: number; receivedRawBytes?: bigint; receivedMessages?: number; lastPartSha256?: string | undefined; expiresInSeconds?: number; limits?: UploadLimits; receipt?: IngestReceipt | undefined; failure?: string | undefined}): UploadState {
        return new UploadState(
            'uploadId' in overrides ? overrides.uploadId! : this._uploadId,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'phase' in overrides ? overrides.phase! : this._phase,
            'append' in overrides ? overrides.append! : this._append,
            'receivedParts' in overrides ? overrides.receivedParts! : this._receivedParts,
            'receivedRawBytes' in overrides ? overrides.receivedRawBytes! : this._receivedRawBytes,
            'receivedMessages' in overrides ? overrides.receivedMessages! : this._receivedMessages,
            'lastPartSha256' in overrides ? overrides.lastPartSha256! : this._lastPartSha256,
            'expiresInSeconds' in overrides ? overrides.expiresInSeconds! : this._expiresInSeconds,
            'limits' in overrides ? overrides.limits! : this._limits,
            'receipt' in overrides ? overrides.receipt! : this._receipt,
            'failure' in overrides ? overrides.failure! : this._failure
        );
    }

    public static fromPlain(obj: {uploadId: string; requestId: string; phase: UploadPhase; append: boolean; receivedParts: number; receivedRawBytes: bigint; receivedMessages: number; lastPartSha256: string | undefined; expiresInSeconds: number; limits: UploadLimits; receipt: IngestReceipt | undefined; failure: string | undefined}): UploadState {
        return new UploadState(
            obj.uploadId,
            obj.requestId,
            obj.phase,
            obj.append,
            obj.receivedParts,
            obj.receivedRawBytes,
            obj.receivedMessages,
            obj.lastPartSha256,
            obj.expiresInSeconds,
            obj.limits,
            obj.receipt,
            obj.failure
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadState.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadState.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadState'
    public baboonTypeIdentifier() {
        return UploadState.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return UploadState.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return UploadState.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return UploadState.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadState_JsonCodec {
        return UploadState_JsonCodec.instance
    }
}

export class UploadState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadState): unknown {
        if (this !== UploadState_JsonCodec.lazyInstance.value) {
          return UploadState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "uploadId": value.uploadId,
            "requestId": value.requestId,
            "phase": UploadPhase_JsonCodec.instance.encode(BaboonCodecContext.Default, value.phase),
            "append": value.append,
            "receivedParts": value.receivedParts,
            "receivedRawBytes": value.receivedRawBytes.toString(),
            "receivedMessages": value.receivedMessages,
            "lastPartSha256": value.lastPartSha256 === undefined ? null : value.lastPartSha256,
            "expiresInSeconds": value.expiresInSeconds,
            "limits": UploadLimits_JsonCodec.instance.encode(BaboonCodecContext.Default, value.limits),
            "receipt": value.receipt === undefined ? null : IngestReceipt_JsonCodec.instance.encode(BaboonCodecContext.Default, value.receipt),
            "failure": value.failure === undefined ? null : value.failure,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadState {
        if (this !== UploadState_JsonCodec .lazyInstance.value) {
            return UploadState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadState (
            obj["uploadId"] as string,
            obj["requestId"] as string,
            UploadPhase_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["phase"]),
            obj["append"] as boolean,
            obj["receivedParts"] as number,
            BaboonInt64.read(obj["receivedRawBytes"], "i64/u64"),
            obj["receivedMessages"] as number,
            obj["lastPartSha256"] === undefined || obj["lastPartSha256"] === null ? undefined : obj["lastPartSha256"] === undefined || obj["lastPartSha256"] === null ? undefined : obj["lastPartSha256"] as string,
            obj["expiresInSeconds"] as number,
            UploadLimits_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["limits"]),
            obj["receipt"] === undefined || obj["receipt"] === null ? undefined : obj["receipt"] === undefined || obj["receipt"] === null ? undefined : IngestReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["receipt"]),
            obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadState'
    public baboonTypeIdentifier() {
        return UploadState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadState_JsonCodec())
    public static get instance(): UploadState_JsonCodec {
        return UploadState_JsonCodec.lazyInstance.value
    }
}