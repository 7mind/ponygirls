import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Failure implements BaboonGeneratedLatest {
    private readonly _code: string;

    constructor(code: string) {
        this._code = code
    }

    public get code(): string {
        return this._code;
    }

    public toJSON(): Record<string, unknown> {
        return {
            code: this._code
        };
    }

    public with(overrides: {code?: string}): Failure {
        return new Failure(
            'code' in overrides ? overrides.code! : this._code
        );
    }

    public static fromPlain(obj: {code: string}): Failure {
        return new Failure(
            obj.code
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return Failure.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return Failure.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return Failure.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return Failure.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
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
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Failure {
        if (this !== Failure_JsonCodec .lazyInstance.value) {
            return Failure_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Failure (
            obj["code"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return Failure_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return Failure_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#Failure'
    public baboonTypeIdentifier() {
        return Failure_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Failure_JsonCodec())
    public static get instance(): Failure_JsonCodec {
        return Failure_JsonCodec.lazyInstance.value
    }
}