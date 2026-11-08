import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Ack implements BaboonGeneratedLatest {
    private readonly _ok: boolean;

    constructor(ok: boolean) {
        this._ok = ok
    }

    public get ok(): boolean {
        return this._ok;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ok: this._ok
        };
    }

    public with(overrides: {ok?: boolean}): Ack {
        return new Ack(
            'ok' in overrides ? overrides.ok! : this._ok
        );
    }

    public static fromPlain(obj: {ok: boolean}): Ack {
        return new Ack(
            obj.ok
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return Ack.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return Ack.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#Ack'
    public baboonTypeIdentifier() {
        return Ack.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return Ack.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return Ack.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return Ack.BaboonMinReaderVersions
    }
    public static jsonCodec(): Ack_JsonCodec {
        return Ack_JsonCodec.instance
    }
}

export class Ack_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Ack): unknown {
        if (this !== Ack_JsonCodec.lazyInstance.value) {
          return Ack_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ok": value.ok,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Ack {
        if (this !== Ack_JsonCodec .lazyInstance.value) {
            return Ack_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Ack (
            obj["ok"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return Ack_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return Ack_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#Ack'
    public baboonTypeIdentifier() {
        return Ack_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Ack_JsonCodec())
    public static get instance(): Ack_JsonCodec {
        return Ack_JsonCodec.lazyInstance.value
    }
}