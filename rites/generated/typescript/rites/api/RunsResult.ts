import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RunInfo, RunInfo_JsonCodec} from './RunInfo.js'

export class RunsResult implements BaboonGeneratedLatest {
    private readonly _items: Array<RunInfo>;

    constructor(items: Array<RunInfo>) {
        this._items = items
    }

    public get items(): Array<RunInfo> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<RunInfo>}): RunsResult {
        return new RunsResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<RunInfo>}): RunsResult {
        return new RunsResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunsResult'
    public baboonTypeIdentifier() {
        return RunsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RunsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RunsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RunsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RunsResult_JsonCodec {
        return RunsResult_JsonCodec.instance
    }
}

export class RunsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunsResult): unknown {
        if (this !== RunsResult_JsonCodec.lazyInstance.value) {
          return RunsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => RunInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunsResult {
        if (this !== RunsResult_JsonCodec .lazyInstance.value) {
            return RunsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RunsResult (
            (obj["items"] as unknown[]).map(item => RunInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunsResult'
    public baboonTypeIdentifier() {
        return RunsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunsResult_JsonCodec())
    public static get instance(): RunsResult_JsonCodec {
        return RunsResult_JsonCodec.lazyInstance.value
    }
}