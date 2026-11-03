import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {DocumentPayload, DocumentPayload_JsonCodec} from './DocumentPayload.js'
import {Metadata, Metadata_JsonCodec} from './Metadata.js'

export class Item implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _revision: number;
    private readonly _document: DocumentPayload;
    private readonly _metadata: Metadata;

    constructor(key: string, revision: number, document: DocumentPayload, metadata: Metadata) {
        this._key = key
        this._revision = revision
        this._document = document
        this._metadata = metadata
    }

    public get key(): string {
        return this._key;
    }
    public get revision(): number {
        return this._revision;
    }
    public get document(): DocumentPayload {
        return this._document;
    }
    public get metadata(): Metadata {
        return this._metadata;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            revision: this._revision,
            document: this._document,
            metadata: this._metadata
        };
    }

    public with(overrides: {key?: string; revision?: number; document?: DocumentPayload; metadata?: Metadata}): Item {
        return new Item(
            'key' in overrides ? overrides.key! : this._key,
            'revision' in overrides ? overrides.revision! : this._revision,
            'document' in overrides ? overrides.document! : this._document,
            'metadata' in overrides ? overrides.metadata! : this._metadata
        );
    }

    public static fromPlain(obj: {key: string; revision: number; document: DocumentPayload; metadata: Metadata}): Item {
        return new Item(
            obj.key,
            obj.revision,
            obj.document,
            obj.metadata
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Item.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Item.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Item'
    public baboonTypeIdentifier() {
        return Item.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Item.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Item.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Item.BaboonMinReaderVersions
    }
    public static jsonCodec(): Item_JsonCodec {
        return Item_JsonCodec.instance
    }
}

export class Item_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Item): unknown {
        if (this !== Item_JsonCodec.lazyInstance.value) {
          return Item_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "revision": value.revision,
            "document": DocumentPayload_JsonCodec.instance.encode(BaboonCodecContext.Default, value.document),
            "metadata": Metadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Item {
        if (this !== Item_JsonCodec .lazyInstance.value) {
            return Item_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Item (
            obj["key"] as string,
            obj["revision"] as number,
            DocumentPayload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["document"]),
            Metadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Item_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Item_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Item'
    public baboonTypeIdentifier() {
        return Item_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Item_JsonCodec())
    public static get instance(): Item_JsonCodec {
        return Item_JsonCodec.lazyInstance.value
    }
}