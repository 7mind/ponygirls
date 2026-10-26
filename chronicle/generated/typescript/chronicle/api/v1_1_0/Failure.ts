import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class Failure implements BaboonGenerated {
    private readonly _code: string;
    private readonly _message: string;

    constructor(code: string, message: string) {
        this._code = code
        this._message = message
    }

    public get code(): string {
        return this._code;
    }
    public get message(): string {
        return this._message;
    }

    public toJSON(): Record<string, unknown> {
        return {
            code: this._code,
            message: this._message
        };
    }

    public with(overrides: {code?: string; message?: string}): Failure {
        return new Failure(
            'code' in overrides ? overrides.code! : this._code,
            'message' in overrides ? overrides.message! : this._message
        );
    }

    public static fromPlain(obj: {code: string; message: string}): Failure {
        return new Failure(
            obj.code,
            obj.message
        );
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return Failure.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Failure.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Failure.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical" }
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

/** @deprecated Version 1.1.0 is deprecated, you should migrate to 1.3.0 */
export class Failure_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Failure): unknown {
        if (this !== Failure_JsonCodec.lazyInstance.value) {
          return Failure_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "code": value.code,
            "message": value.message,
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
        )
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return Failure_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Failure_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Failure_JsonCodec())
    public static get instance(): Failure_JsonCodec {
        return Failure_JsonCodec.lazyInstance.value
    }
}