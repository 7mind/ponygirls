import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'

export class OAuthClientInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _label: string;
    private readonly _expiryLeadSeconds: number;

    constructor(id: string, forge: ForgeKind, host: string, label: string, expiryLeadSeconds: number) {
        this._id = id
        this._forge = forge
        this._host = host
        this._label = label
        this._expiryLeadSeconds = expiryLeadSeconds
    }

    public get id(): string {
        return this._id;
    }
    public get forge(): ForgeKind {
        return this._forge;
    }
    public get host(): string {
        return this._host;
    }
    public get label(): string {
        return this._label;
    }
    public get expiryLeadSeconds(): number {
        return this._expiryLeadSeconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            forge: this._forge,
            host: this._host,
            label: this._label,
            expiryLeadSeconds: this._expiryLeadSeconds
        };
    }

    public with(overrides: {id?: string; forge?: ForgeKind; host?: string; label?: string; expiryLeadSeconds?: number}): OAuthClientInfo {
        return new OAuthClientInfo(
            'id' in overrides ? overrides.id! : this._id,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'label' in overrides ? overrides.label! : this._label,
            'expiryLeadSeconds' in overrides ? overrides.expiryLeadSeconds! : this._expiryLeadSeconds
        );
    }

    public static fromPlain(obj: {id: string; forge: ForgeKind; host: string; label: string; expiryLeadSeconds: number}): OAuthClientInfo {
        return new OAuthClientInfo(
            obj.id,
            obj.forge,
            obj.host,
            obj.label,
            obj.expiryLeadSeconds
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return OAuthClientInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return OAuthClientInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#OAuthClientInfo'
    public baboonTypeIdentifier() {
        return OAuthClientInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return OAuthClientInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return OAuthClientInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return OAuthClientInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): OAuthClientInfo_JsonCodec {
        return OAuthClientInfo_JsonCodec.instance
    }
}

export class OAuthClientInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OAuthClientInfo): unknown {
        if (this !== OAuthClientInfo_JsonCodec.lazyInstance.value) {
          return OAuthClientInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "forge": ForgeKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.forge),
            "host": value.host,
            "label": value.label,
            "expiryLeadSeconds": value.expiryLeadSeconds,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OAuthClientInfo {
        if (this !== OAuthClientInfo_JsonCodec .lazyInstance.value) {
            return OAuthClientInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OAuthClientInfo (
            obj["id"] as string,
            ForgeKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["forge"]),
            obj["host"] as string,
            obj["label"] as string,
            obj["expiryLeadSeconds"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return OAuthClientInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return OAuthClientInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#OAuthClientInfo'
    public baboonTypeIdentifier() {
        return OAuthClientInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OAuthClientInfo_JsonCodec())
    public static get instance(): OAuthClientInfo_JsonCodec {
        return OAuthClientInfo_JsonCodec.lazyInstance.value
    }
}