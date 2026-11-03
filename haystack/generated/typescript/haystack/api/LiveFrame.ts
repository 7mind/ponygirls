import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class LiveFrame implements BaboonGeneratedLatest {
    private readonly _kind: string;
    private readonly _key: string | undefined;
    private readonly _revision: number | undefined;
    private readonly _nonce: string | undefined;
    private readonly _clientTs: number | undefined;
    private readonly _serverTs: number | undefined;

    constructor(kind: string, key: string | undefined, revision: number | undefined, nonce: string | undefined, clientTs: number | undefined, serverTs: number | undefined) {
        this._kind = kind
        this._key = key
        this._revision = revision
        this._nonce = nonce
        this._clientTs = clientTs
        this._serverTs = serverTs
    }

    public get kind(): string {
        return this._kind;
    }
    public get key(): string | undefined {
        return this._key;
    }
    public get revision(): number | undefined {
        return this._revision;
    }
    public get nonce(): string | undefined {
        return this._nonce;
    }
    public get clientTs(): number | undefined {
        return this._clientTs;
    }
    public get serverTs(): number | undefined {
        return this._serverTs;
    }

    public toJSON(): Record<string, unknown> {
        return {
            kind: this._kind,
            key: this._key !== undefined ? this._key : undefined,
            revision: this._revision !== undefined ? this._revision : undefined,
            nonce: this._nonce !== undefined ? this._nonce : undefined,
            clientTs: this._clientTs !== undefined ? this._clientTs : undefined,
            serverTs: this._serverTs !== undefined ? this._serverTs : undefined
        };
    }

    public with(overrides: {kind?: string; key?: string | undefined; revision?: number | undefined; nonce?: string | undefined; clientTs?: number | undefined; serverTs?: number | undefined}): LiveFrame {
        return new LiveFrame(
            'kind' in overrides ? overrides.kind! : this._kind,
            'key' in overrides ? overrides.key! : this._key,
            'revision' in overrides ? overrides.revision! : this._revision,
            'nonce' in overrides ? overrides.nonce! : this._nonce,
            'clientTs' in overrides ? overrides.clientTs! : this._clientTs,
            'serverTs' in overrides ? overrides.serverTs! : this._serverTs
        );
    }

    public static fromPlain(obj: {kind: string; key: string | undefined; revision: number | undefined; nonce: string | undefined; clientTs: number | undefined; serverTs: number | undefined}): LiveFrame {
        return new LiveFrame(
            obj.kind,
            obj.key,
            obj.revision,
            obj.nonce,
            obj.clientTs,
            obj.serverTs
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return LiveFrame.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return LiveFrame.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#LiveFrame'
    public baboonTypeIdentifier() {
        return LiveFrame.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return LiveFrame.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return LiveFrame.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return LiveFrame.BaboonMinReaderVersions
    }
    public static jsonCodec(): LiveFrame_JsonCodec {
        return LiveFrame_JsonCodec.instance
    }
}

export class LiveFrame_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LiveFrame): unknown {
        if (this !== LiveFrame_JsonCodec.lazyInstance.value) {
          return LiveFrame_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "kind": value.kind,
            "key": value.key === undefined ? null : value.key,
            "revision": value.revision === undefined ? null : value.revision,
            "nonce": value.nonce === undefined ? null : value.nonce,
            "clientTs": value.clientTs === undefined ? null : value.clientTs,
            "serverTs": value.serverTs === undefined ? null : value.serverTs,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LiveFrame {
        if (this !== LiveFrame_JsonCodec .lazyInstance.value) {
            return LiveFrame_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new LiveFrame (
            obj["kind"] as string,
            obj["key"] === undefined || obj["key"] === null ? undefined : obj["key"] === undefined || obj["key"] === null ? undefined : obj["key"] as string,
            obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] as number,
            obj["nonce"] === undefined || obj["nonce"] === null ? undefined : obj["nonce"] === undefined || obj["nonce"] === null ? undefined : obj["nonce"] as string,
            obj["clientTs"] === undefined || obj["clientTs"] === null ? undefined : obj["clientTs"] === undefined || obj["clientTs"] === null ? undefined : obj["clientTs"] as number,
            obj["serverTs"] === undefined || obj["serverTs"] === null ? undefined : obj["serverTs"] === undefined || obj["serverTs"] === null ? undefined : obj["serverTs"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return LiveFrame_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return LiveFrame_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#LiveFrame'
    public baboonTypeIdentifier() {
        return LiveFrame_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LiveFrame_JsonCodec())
    public static get instance(): LiveFrame_JsonCodec {
        return LiveFrame_JsonCodec.lazyInstance.value
    }
}