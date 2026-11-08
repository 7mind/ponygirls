import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RiteInfo, RiteInfo_JsonCodec} from './RiteInfo.js'

export class RitesResult implements BaboonGeneratedLatest {
    private readonly _items: Array<RiteInfo>;

    constructor(items: Array<RiteInfo>) {
        this._items = items
    }

    public get items(): Array<RiteInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<RiteInfo>}): RitesResult {
        return new RitesResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<RiteInfo>}): RitesResult {
        return new RitesResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RitesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RitesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RitesResult'
    public baboonTypeIdentifier() {
        return RitesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RitesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RitesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RitesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RitesResult_JsonCodec {
        return RitesResult_JsonCodec.instance
    }
}

export class RitesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RitesResult): unknown {
        if (this !== RitesResult_JsonCodec.lazyInstance.value) {
          return RitesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => RiteInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RitesResult {
        if (this !== RitesResult_JsonCodec .lazyInstance.value) {
            return RitesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RitesResult (
            (obj["items"] as unknown[]).map(item => RiteInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RitesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RitesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RitesResult'
    public baboonTypeIdentifier() {
        return RitesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RitesResult_JsonCodec())
    public static get instance(): RitesResult_JsonCodec {
        return RitesResult_JsonCodec.lazyInstance.value
    }
}