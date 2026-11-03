import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ErrorCode, ErrorCode_JsonCodec} from './ErrorCode.js'

export class Failure implements BaboonGeneratedLatest {
    private readonly _code: ErrorCode;
    private readonly _message: string;
    private readonly _retryAfterSeconds: number | undefined;

    constructor(code: ErrorCode, message: string, retryAfterSeconds: number | undefined) {
        this._code = code
        this._message = message
        this._retryAfterSeconds = retryAfterSeconds
    }

    public get code(): ErrorCode {
        return this._code;
    }
    public get message(): string {
        return this._message;
    }
    public get retryAfterSeconds(): number | undefined {
        return this._retryAfterSeconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            code: this._code,
            message: this._message,
            retryAfterSeconds: this._retryAfterSeconds !== undefined ? this._retryAfterSeconds : undefined
        };
    }

    public with(overrides: {code?: ErrorCode; message?: string; retryAfterSeconds?: number | undefined}): Failure {
        return new Failure(
            'code' in overrides ? overrides.code! : this._code,
            'message' in overrides ? overrides.message! : this._message,
            'retryAfterSeconds' in overrides ? overrides.retryAfterSeconds! : this._retryAfterSeconds
        );
    }

    public static fromPlain(obj: {code: ErrorCode; message: string; retryAfterSeconds: number | undefined}): Failure {
        return new Failure(
            obj.code,
            obj.message,
            obj.retryAfterSeconds
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Failure.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Failure.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Failure'
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
            "code": ErrorCode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.code),
            "message": value.message,
            "retryAfterSeconds": value.retryAfterSeconds === undefined ? null : value.retryAfterSeconds,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Failure {
        if (this !== Failure_JsonCodec .lazyInstance.value) {
            return Failure_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Failure (
            ErrorCode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["code"]),
            obj["message"] as string,
            obj["retryAfterSeconds"] === undefined || obj["retryAfterSeconds"] === null ? undefined : obj["retryAfterSeconds"] === undefined || obj["retryAfterSeconds"] === null ? undefined : obj["retryAfterSeconds"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Failure_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Failure_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Failure_JsonCodec())
    public static get instance(): Failure_JsonCodec {
        return Failure_JsonCodec.lazyInstance.value
    }
}