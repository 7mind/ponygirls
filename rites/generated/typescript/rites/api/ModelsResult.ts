import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ModelInfo, ModelInfo_JsonCodec} from './ModelInfo.js'

export class ModelsResult implements BaboonGeneratedLatest {
    private readonly _items: Array<ModelInfo>;

    constructor(items: Array<ModelInfo>) {
        this._items = items
    }

    public get items(): Array<ModelInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<ModelInfo>}): ModelsResult {
        return new ModelsResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<ModelInfo>}): ModelsResult {
        return new ModelsResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return ModelsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ModelsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ModelsResult'
    public baboonTypeIdentifier() {
        return ModelsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return ModelsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return ModelsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return ModelsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ModelsResult_JsonCodec {
        return ModelsResult_JsonCodec.instance
    }
}

export class ModelsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelsResult): unknown {
        if (this !== ModelsResult_JsonCodec.lazyInstance.value) {
          return ModelsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => ModelInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelsResult {
        if (this !== ModelsResult_JsonCodec .lazyInstance.value) {
            return ModelsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ModelsResult (
            (obj["items"] as unknown[]).map(item => ModelInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return ModelsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ModelsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ModelsResult'
    public baboonTypeIdentifier() {
        return ModelsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelsResult_JsonCodec())
    public static get instance(): ModelsResult_JsonCodec {
        return ModelsResult_JsonCodec.lazyInstance.value
    }
}