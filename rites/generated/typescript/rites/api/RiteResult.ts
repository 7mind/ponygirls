import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RiteInfo, RiteInfo_JsonCodec} from './RiteInfo.js'

export class RiteResult implements BaboonGeneratedLatest {
    private readonly _rite: RiteInfo;

    constructor(rite: RiteInfo) {
        this._rite = rite
    }

    public get rite(): RiteInfo {
        return this._rite;
    }

    public toJSON(): Record<string, unknown> {
        return {
            rite: this._rite
        };
    }

    public with(overrides: {rite?: RiteInfo}): RiteResult {
        return new RiteResult(
            'rite' in overrides ? overrides.rite! : this._rite
        );
    }

    public static fromPlain(obj: {rite: RiteInfo}): RiteResult {
        return new RiteResult(
            obj.rite
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RiteResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RiteResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RiteResult'
    public baboonTypeIdentifier() {
        return RiteResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RiteResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RiteResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RiteResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RiteResult_JsonCodec {
        return RiteResult_JsonCodec.instance
    }
}

export class RiteResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RiteResult): unknown {
        if (this !== RiteResult_JsonCodec.lazyInstance.value) {
          return RiteResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "rite": RiteInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.rite),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RiteResult {
        if (this !== RiteResult_JsonCodec .lazyInstance.value) {
            return RiteResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RiteResult (
            RiteInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["rite"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RiteResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RiteResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RiteResult'
    public baboonTypeIdentifier() {
        return RiteResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RiteResult_JsonCodec())
    public static get instance(): RiteResult_JsonCodec {
        return RiteResult_JsonCodec.lazyInstance.value
    }
}