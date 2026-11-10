import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ScopeSummary, ScopeSummary_JsonCodec} from './ScopeSummary.js'

export class ScopesResult implements BaboonGeneratedLatest {
    private readonly _items: Array<ScopeSummary>;

    constructor(items: Array<ScopeSummary>) {
        this._items = items
    }

    public get items(): Array<ScopeSummary> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<ScopeSummary>}): ScopesResult {
        return new ScopesResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<ScopeSummary>}): ScopesResult {
        return new ScopesResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopesResult'
    public baboonTypeIdentifier() {
        return ScopesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ScopesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ScopesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ScopesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ScopesResult_JsonCodec {
        return ScopesResult_JsonCodec.instance
    }
}

export class ScopesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ScopesResult): unknown {
        if (this !== ScopesResult_JsonCodec.lazyInstance.value) {
          return ScopesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => ScopeSummary_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ScopesResult {
        if (this !== ScopesResult_JsonCodec .lazyInstance.value) {
            return ScopesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ScopesResult (
            (obj["items"] as unknown[]).map(item => ScopeSummary_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopesResult'
    public baboonTypeIdentifier() {
        return ScopesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ScopesResult_JsonCodec())
    public static get instance(): ScopesResult_JsonCodec {
        return ScopesResult_JsonCodec.lazyInstance.value
    }
}