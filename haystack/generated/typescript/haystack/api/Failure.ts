import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Span, Span_JsonCodec} from './Span.js'

export class Failure implements BaboonGeneratedLatest {
    private readonly _code: string;
    private readonly _message: string;
    private readonly _spans: Array<Span>;
    private readonly _currentRevision: number | undefined;

    constructor(code: string, message: string, spans: Array<Span>, currentRevision: number | undefined) {
        this._code = code
        this._message = message
        this._spans = spans
        this._currentRevision = currentRevision
    }

    public get code(): string {
        return this._code;
    }
    public get message(): string {
        return this._message;
    }
    public get spans(): Array<Span> {
        return this._spans;
    }
    public get currentRevision(): number | undefined {
        return this._currentRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            code: this._code,
            message: this._message,
            spans: this._spans,
            currentRevision: this._currentRevision !== undefined ? this._currentRevision : undefined
        };
    }

    public with(overrides: {code?: string; message?: string; spans?: Array<Span>; currentRevision?: number | undefined}): Failure {
        return new Failure(
            'code' in overrides ? overrides.code! : this._code,
            'message' in overrides ? overrides.message! : this._message,
            'spans' in overrides ? overrides.spans! : this._spans,
            'currentRevision' in overrides ? overrides.currentRevision! : this._currentRevision
        );
    }

    public static fromPlain(obj: {code: string; message: string; spans: Array<Span>; currentRevision: number | undefined}): Failure {
        return new Failure(
            obj.code,
            obj.message,
            obj.spans,
            obj.currentRevision
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Failure.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Failure.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Failure.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Failure.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Failure.BaboonMinReaderVersions
    }
    public static jsonCodec(): Failure_JsonCodec {
        return Failure_JsonCodec.instance
    }
}

export class Failure_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Failure): unknown {
        if (this !== Failure_JsonCodec.lazyInstance.value) {
          return Failure_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "code": value.code,
            "message": value.message,
            "spans": Array.from(value.spans).map(item => Span_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "currentRevision": value.currentRevision === undefined ? null : value.currentRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Failure {
        if (this !== Failure_JsonCodec .lazyInstance.value) {
            return Failure_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Failure (
            obj["code"] as string,
            obj["message"] as string,
            (obj["spans"] as unknown[]).map(item => Span_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["currentRevision"] === undefined || obj["currentRevision"] === null ? undefined : obj["currentRevision"] === undefined || obj["currentRevision"] === null ? undefined : obj["currentRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Failure_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Failure_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Failure_JsonCodec())
    public static get instance(): Failure_JsonCodec {
        return Failure_JsonCodec.lazyInstance.value
    }
}