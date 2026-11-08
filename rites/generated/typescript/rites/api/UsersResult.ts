import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'

export class UsersResult implements BaboonGeneratedLatest {
    private readonly _items: Array<UserInfo>;

    constructor(items: Array<UserInfo>) {
        this._items = items
    }

    public get items(): Array<UserInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<UserInfo>}): UsersResult {
        return new UsersResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<UserInfo>}): UsersResult {
        return new UsersResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return UsersResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return UsersResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#UsersResult'
    public baboonTypeIdentifier() {
        return UsersResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return UsersResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return UsersResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return UsersResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): UsersResult_JsonCodec {
        return UsersResult_JsonCodec.instance
    }
}

export class UsersResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UsersResult): unknown {
        if (this !== UsersResult_JsonCodec.lazyInstance.value) {
          return UsersResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UsersResult {
        if (this !== UsersResult_JsonCodec .lazyInstance.value) {
            return UsersResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UsersResult (
            (obj["items"] as unknown[]).map(item => UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return UsersResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return UsersResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#UsersResult'
    public baboonTypeIdentifier() {
        return UsersResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UsersResult_JsonCodec())
    public static get instance(): UsersResult_JsonCodec {
        return UsersResult_JsonCodec.lazyInstance.value
    }
}