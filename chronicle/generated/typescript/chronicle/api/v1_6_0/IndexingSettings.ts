import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class IndexingSettings implements BaboonGenerated {
    private readonly _annotationSessions: number;
    private readonly _embeddingRequests: number;
    private readonly _embeddingBatchSize: number;

    constructor(annotationSessions: number, embeddingRequests: number, embeddingBatchSize: number) {
        this._annotationSessions = annotationSessions
        this._embeddingRequests = embeddingRequests
        this._embeddingBatchSize = embeddingBatchSize
    }

    public get annotationSessions(): number {
        return this._annotationSessions;
    }
    public get embeddingRequests(): number {
        return this._embeddingRequests;
    }
    public get embeddingBatchSize(): number {
        return this._embeddingBatchSize;
    }

    public toJSON(): Record<string, unknown> {
        return {
            annotationSessions: this._annotationSessions,
            embeddingRequests: this._embeddingRequests,
            embeddingBatchSize: this._embeddingBatchSize
        };
    }

    public with(overrides: {annotationSessions?: number; embeddingRequests?: number; embeddingBatchSize?: number}): IndexingSettings {
        return new IndexingSettings(
            'annotationSessions' in overrides ? overrides.annotationSessions! : this._annotationSessions,
            'embeddingRequests' in overrides ? overrides.embeddingRequests! : this._embeddingRequests,
            'embeddingBatchSize' in overrides ? overrides.embeddingBatchSize! : this._embeddingBatchSize
        );
    }

    public static fromPlain(obj: {annotationSessions: number; embeddingRequests: number; embeddingBatchSize: number}): IndexingSettings {
        return new IndexingSettings(
            obj.annotationSessions,
            obj.embeddingRequests,
            obj.embeddingBatchSize
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return IndexingSettings.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IndexingSettings.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IndexingSettings'
    public baboonTypeIdentifier() {
        return IndexingSettings.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return IndexingSettings.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return IndexingSettings.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return IndexingSettings.BaboonMinReaderVersions
    }
    public static jsonCodec(): IndexingSettings_JsonCodec {
        return IndexingSettings_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.8.0 */
export class IndexingSettings_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IndexingSettings): unknown {
        if (this !== IndexingSettings_JsonCodec.lazyInstance.value) {
          return IndexingSettings_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "annotationSessions": value.annotationSessions,
            "embeddingRequests": value.embeddingRequests,
            "embeddingBatchSize": value.embeddingBatchSize,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IndexingSettings {
        if (this !== IndexingSettings_JsonCodec .lazyInstance.value) {
            return IndexingSettings_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IndexingSettings (
            obj["annotationSessions"] as number,
            obj["embeddingRequests"] as number,
            obj["embeddingBatchSize"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return IndexingSettings_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IndexingSettings_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IndexingSettings'
    public baboonTypeIdentifier() {
        return IndexingSettings_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IndexingSettings_JsonCodec())
    public static get instance(): IndexingSettings_JsonCodec {
        return IndexingSettings_JsonCodec.lazyInstance.value
    }
}