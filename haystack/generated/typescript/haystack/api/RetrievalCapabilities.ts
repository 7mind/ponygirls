import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RetrievalMode, RetrievalMode_JsonCodec} from './RetrievalMode.js'

export class RetrievalCapabilities implements BaboonGeneratedLatest {
    private readonly _modes: Array<RetrievalMode>;

    constructor(modes: Array<RetrievalMode>) {
        this._modes = modes
    }

    public get modes(): Array<RetrievalMode> {
        return this._modes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            modes: this._modes
        };
    }

    public with(overrides: {modes?: Array<RetrievalMode>}): RetrievalCapabilities {
        return new RetrievalCapabilities(
            'modes' in overrides ? overrides.modes! : this._modes
        );
    }

    public static fromPlain(obj: {modes: Array<RetrievalMode>}): RetrievalCapabilities {
        return new RetrievalCapabilities(
            obj.modes
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrievalCapabilities.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrievalCapabilities.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrievalCapabilities'
    public baboonTypeIdentifier() {
        return RetrievalCapabilities.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return RetrievalCapabilities.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return RetrievalCapabilities.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RetrievalCapabilities.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetrievalCapabilities_JsonCodec {
        return RetrievalCapabilities_JsonCodec.instance
    }
}

export class RetrievalCapabilities_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetrievalCapabilities): unknown {
        if (this !== RetrievalCapabilities_JsonCodec.lazyInstance.value) {
          return RetrievalCapabilities_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "modes": Array.from(value.modes).map(item => RetrievalMode_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetrievalCapabilities {
        if (this !== RetrievalCapabilities_JsonCodec .lazyInstance.value) {
            return RetrievalCapabilities_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetrievalCapabilities (
            (obj["modes"] as unknown[]).map(item => RetrievalMode_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrievalCapabilities_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrievalCapabilities_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrievalCapabilities'
    public baboonTypeIdentifier() {
        return RetrievalCapabilities_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetrievalCapabilities_JsonCodec())
    public static get instance(): RetrievalCapabilities_JsonCodec {
        return RetrievalCapabilities_JsonCodec.lazyInstance.value
    }
}