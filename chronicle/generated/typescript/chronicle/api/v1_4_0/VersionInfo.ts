import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class VersionInfo implements BaboonGenerated {
    private readonly _current: string;
    private readonly _minimum: string;
    private readonly _supported: Array<string>;

    constructor(current: string, minimum: string, supported: Array<string>) {
        this._current = current
        this._minimum = minimum
        this._supported = supported
    }

    public get current(): string {
        return this._current;
    }
    public get minimum(): string {
        return this._minimum;
    }
    public get supported(): Array<string> {
        return this._supported;
    }

    public toJSON(): Record<string, unknown> {
        return {
            current: this._current,
            minimum: this._minimum,
            supported: this._supported
        };
    }

    public with(overrides: {current?: string; minimum?: string; supported?: Array<string>}): VersionInfo {
        return new VersionInfo(
            'current' in overrides ? overrides.current! : this._current,
            'minimum' in overrides ? overrides.minimum! : this._minimum,
            'supported' in overrides ? overrides.supported! : this._supported
        );
    }

    public static fromPlain(obj: {current: string; minimum: string; supported: Array<string>}): VersionInfo {
        return new VersionInfo(
            obj.current,
            obj.minimum,
            obj.supported
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return VersionInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return VersionInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#VersionInfo'
    public baboonTypeIdentifier() {
        return VersionInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return VersionInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return VersionInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return VersionInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): VersionInfo_JsonCodec {
        return VersionInfo_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.7.0 */
export class VersionInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: VersionInfo): unknown {
        if (this !== VersionInfo_JsonCodec.lazyInstance.value) {
          return VersionInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "current": value.current,
            "minimum": value.minimum,
            "supported": Array.from(value.supported),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): VersionInfo {
        if (this !== VersionInfo_JsonCodec .lazyInstance.value) {
            return VersionInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new VersionInfo (
            obj["current"] as string,
            obj["minimum"] as string,
            (obj["supported"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return VersionInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return VersionInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#VersionInfo'
    public baboonTypeIdentifier() {
        return VersionInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new VersionInfo_JsonCodec())
    public static get instance(): VersionInfo_JsonCodec {
        return VersionInfo_JsonCodec.lazyInstance.value
    }
}