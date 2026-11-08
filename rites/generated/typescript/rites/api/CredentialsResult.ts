import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CredentialInfo, CredentialInfo_JsonCodec} from './CredentialInfo.js'

export class CredentialsResult implements BaboonGeneratedLatest {
    private readonly _items: Array<CredentialInfo>;

    constructor(items: Array<CredentialInfo>) {
        this._items = items
    }

    public get items(): Array<CredentialInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<CredentialInfo>}): CredentialsResult {
        return new CredentialsResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<CredentialInfo>}): CredentialsResult {
        return new CredentialsResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialsResult'
    public baboonTypeIdentifier() {
        return CredentialsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return CredentialsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return CredentialsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return CredentialsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): CredentialsResult_JsonCodec {
        return CredentialsResult_JsonCodec.instance
    }
}

export class CredentialsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CredentialsResult): unknown {
        if (this !== CredentialsResult_JsonCodec.lazyInstance.value) {
          return CredentialsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => CredentialInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CredentialsResult {
        if (this !== CredentialsResult_JsonCodec .lazyInstance.value) {
            return CredentialsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CredentialsResult (
            (obj["items"] as unknown[]).map(item => CredentialInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialsResult'
    public baboonTypeIdentifier() {
        return CredentialsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CredentialsResult_JsonCodec())
    public static get instance(): CredentialsResult_JsonCodec {
        return CredentialsResult_JsonCodec.lazyInstance.value
    }
}