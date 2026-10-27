import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class Facet implements BaboonGenerated {
    private readonly _value: string;
    private readonly _count: number;

    constructor(value: string, count: number) {
        this._value = value
        this._count = count
    }

    public get value(): string {
        return this._value;
    }
    public get count(): number {
        return this._count;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value,
            count: this._count
        };
    }

    public with(overrides: {value?: string; count?: number}): Facet {
        return new Facet(
            'value' in overrides ? overrides.value! : this._value,
            'count' in overrides ? overrides.count! : this._count
        );
    }

    public static fromPlain(obj: {value: string; count: number}): Facet {
        return new Facet(
            obj.value,
            obj.count
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Facet.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Facet.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Facet'
    public baboonTypeIdentifier() {
        return Facet.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return Facet.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return Facet.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Facet.BaboonMinReaderVersions
    }
    public static jsonCodec(): Facet_JsonCodec {
        return Facet_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.5.0 */
export class Facet_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Facet): unknown {
        if (this !== Facet_JsonCodec.lazyInstance.value) {
          return Facet_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": value.value,
            "count": value.count,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Facet {
        if (this !== Facet_JsonCodec .lazyInstance.value) {
            return Facet_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Facet (
            obj["value"] as string,
            obj["count"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Facet_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Facet_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Facet'
    public baboonTypeIdentifier() {
        return Facet_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Facet_JsonCodec())
    public static get instance(): Facet_JsonCodec {
        return Facet_JsonCodec.lazyInstance.value
    }
}