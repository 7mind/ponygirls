import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class SearchSort implements BaboonGeneratedLatest {
    private readonly _field: string;
    private readonly _direction: string;

    constructor(field: string, direction: string) {
        this._field = field
        this._direction = direction
    }

    public get field(): string {
        return this._field;
    }
    public get direction(): string {
        return this._direction;
    }

    public toJSON(): Record<string, unknown> {
        return {
            field: this._field,
            direction: this._direction
        };
    }

    public with(overrides: {field?: string; direction?: string}): SearchSort {
        return new SearchSort(
            'field' in overrides ? overrides.field! : this._field,
            'direction' in overrides ? overrides.direction! : this._direction
        );
    }

    public static fromPlain(obj: {field: string; direction: string}): SearchSort {
        return new SearchSort(
            obj.field,
            obj.direction
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchSort.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchSort.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchSort'
    public baboonTypeIdentifier() {
        return SearchSort.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchSort.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchSort.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchSort.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchSort_JsonCodec {
        return SearchSort_JsonCodec.instance
    }
}

export class SearchSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchSort): unknown {
        if (this !== SearchSort_JsonCodec.lazyInstance.value) {
          return SearchSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "field": value.field,
            "direction": value.direction,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchSort {
        if (this !== SearchSort_JsonCodec .lazyInstance.value) {
            return SearchSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchSort (
            obj["field"] as string,
            obj["direction"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchSort'
    public baboonTypeIdentifier() {
        return SearchSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchSort_JsonCodec())
    public static get instance(): SearchSort_JsonCodec {
        return SearchSort_JsonCodec.lazyInstance.value
    }
}