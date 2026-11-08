import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {OAuthClientInfo, OAuthClientInfo_JsonCodec} from './OAuthClientInfo.js'

export class OAuthClientsResult implements BaboonGeneratedLatest {
    private readonly _items: Array<OAuthClientInfo>;

    constructor(items: Array<OAuthClientInfo>) {
        this._items = items
    }

    public get items(): Array<OAuthClientInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<OAuthClientInfo>}): OAuthClientsResult {
        return new OAuthClientsResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<OAuthClientInfo>}): OAuthClientsResult {
        return new OAuthClientsResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return OAuthClientsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return OAuthClientsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#OAuthClientsResult'
    public baboonTypeIdentifier() {
        return OAuthClientsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return OAuthClientsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return OAuthClientsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return OAuthClientsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): OAuthClientsResult_JsonCodec {
        return OAuthClientsResult_JsonCodec.instance
    }
}

export class OAuthClientsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OAuthClientsResult): unknown {
        if (this !== OAuthClientsResult_JsonCodec.lazyInstance.value) {
          return OAuthClientsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => OAuthClientInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OAuthClientsResult {
        if (this !== OAuthClientsResult_JsonCodec .lazyInstance.value) {
            return OAuthClientsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OAuthClientsResult (
            (obj["items"] as unknown[]).map(item => OAuthClientInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return OAuthClientsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return OAuthClientsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#OAuthClientsResult'
    public baboonTypeIdentifier() {
        return OAuthClientsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OAuthClientsResult_JsonCodec())
    public static get instance(): OAuthClientsResult_JsonCodec {
        return OAuthClientsResult_JsonCodec.lazyInstance.value
    }
}