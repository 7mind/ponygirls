import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RepositoryInfo, RepositoryInfo_JsonCodec} from './RepositoryInfo.js'

export class RepositoriesResult implements BaboonGeneratedLatest {
    private readonly _items: Array<RepositoryInfo>;

    constructor(items: Array<RepositoryInfo>) {
        this._items = items
    }

    public get items(): Array<RepositoryInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<RepositoryInfo>}): RepositoriesResult {
        return new RepositoriesResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<RepositoryInfo>}): RepositoriesResult {
        return new RepositoriesResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RepositoriesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoriesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoriesResult'
    public baboonTypeIdentifier() {
        return RepositoriesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RepositoriesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RepositoriesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RepositoriesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RepositoriesResult_JsonCodec {
        return RepositoriesResult_JsonCodec.instance
    }
}

export class RepositoriesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RepositoriesResult): unknown {
        if (this !== RepositoriesResult_JsonCodec.lazyInstance.value) {
          return RepositoriesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => RepositoryInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RepositoriesResult {
        if (this !== RepositoriesResult_JsonCodec .lazyInstance.value) {
            return RepositoriesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RepositoriesResult (
            (obj["items"] as unknown[]).map(item => RepositoryInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RepositoriesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoriesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoriesResult'
    public baboonTypeIdentifier() {
        return RepositoriesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RepositoriesResult_JsonCodec())
    public static get instance(): RepositoriesResult_JsonCodec {
        return RepositoriesResult_JsonCodec.lazyInstance.value
    }
}