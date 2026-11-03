import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Metadata, Metadata_JsonCodec} from './Metadata.js'

export class PutResult implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _revision: number;
    private readonly _metadata: Metadata;
    private readonly _replayed: boolean;

    constructor(key: string, revision: number, metadata: Metadata, replayed: boolean) {
        this._key = key
        this._revision = revision
        this._metadata = metadata
        this._replayed = replayed
    }

    public get key(): string {
        return this._key;
    }
    public get revision(): number {
        return this._revision;
    }
    public get metadata(): Metadata {
        return this._metadata;
    }
    public get replayed(): boolean {
        return this._replayed;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            revision: this._revision,
            metadata: this._metadata,
            replayed: this._replayed
        };
    }

    public with(overrides: {key?: string; revision?: number; metadata?: Metadata; replayed?: boolean}): PutResult {
        return new PutResult(
            'key' in overrides ? overrides.key! : this._key,
            'revision' in overrides ? overrides.revision! : this._revision,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'replayed' in overrides ? overrides.replayed! : this._replayed
        );
    }

    public static fromPlain(obj: {key: string; revision: number; metadata: Metadata; replayed: boolean}): PutResult {
        return new PutResult(
            obj.key,
            obj.revision,
            obj.metadata,
            obj.replayed
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return PutResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return PutResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#PutResult'
    public baboonTypeIdentifier() {
        return PutResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return PutResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return PutResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return PutResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): PutResult_JsonCodec {
        return PutResult_JsonCodec.instance
    }
}

export class PutResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PutResult): unknown {
        if (this !== PutResult_JsonCodec.lazyInstance.value) {
          return PutResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "revision": value.revision,
            "metadata": Metadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
            "replayed": value.replayed,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PutResult {
        if (this !== PutResult_JsonCodec .lazyInstance.value) {
            return PutResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PutResult (
            obj["key"] as string,
            obj["revision"] as number,
            Metadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
            obj["replayed"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return PutResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return PutResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#PutResult'
    public baboonTypeIdentifier() {
        return PutResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PutResult_JsonCodec())
    public static get instance(): PutResult_JsonCodec {
        return PutResult_JsonCodec.lazyInstance.value
    }
}