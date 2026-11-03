import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentMode, ContentMode_JsonCodec} from './ContentMode.js'
import {SearchMode, SearchMode_JsonCodec} from './SearchMode.js'

export class Capabilities implements BaboonGeneratedLatest {
    private readonly _contentMode: ContentMode;
    private readonly _searchModes: Array<SearchMode>;
    private readonly _metadataOnlySearch: boolean;
    private readonly _chunkBytes: number;
    private readonly _maxListLimit: number;
    private readonly _maxRequestBodyBytes: bigint;
    private readonly _maxFileBytes: bigint;
    private readonly _maxArtifactBytes: bigint;
    private readonly _maxFilesPerArtifact: number;
    private readonly _maxTtlSeconds: number;
    private readonly _cataloguePolicy: string;

    constructor(contentMode: ContentMode, searchModes: Array<SearchMode>, metadataOnlySearch: boolean, chunkBytes: number, maxListLimit: number, maxRequestBodyBytes: bigint, maxFileBytes: bigint, maxArtifactBytes: bigint, maxFilesPerArtifact: number, maxTtlSeconds: number, cataloguePolicy: string) {
        this._contentMode = contentMode
        this._searchModes = searchModes
        this._metadataOnlySearch = metadataOnlySearch
        this._chunkBytes = chunkBytes
        this._maxListLimit = maxListLimit
        this._maxRequestBodyBytes = maxRequestBodyBytes
        this._maxFileBytes = maxFileBytes
        this._maxArtifactBytes = maxArtifactBytes
        this._maxFilesPerArtifact = maxFilesPerArtifact
        this._maxTtlSeconds = maxTtlSeconds
        this._cataloguePolicy = cataloguePolicy
    }

    public get contentMode(): ContentMode {
        return this._contentMode;
    }
    public get searchModes(): Array<SearchMode> {
        return this._searchModes;
    }
    public get metadataOnlySearch(): boolean {
        return this._metadataOnlySearch;
    }
    public get chunkBytes(): number {
        return this._chunkBytes;
    }
    public get maxListLimit(): number {
        return this._maxListLimit;
    }
    public get maxRequestBodyBytes(): bigint {
        return this._maxRequestBodyBytes;
    }
    public get maxFileBytes(): bigint {
        return this._maxFileBytes;
    }
    public get maxArtifactBytes(): bigint {
        return this._maxArtifactBytes;
    }
    public get maxFilesPerArtifact(): number {
        return this._maxFilesPerArtifact;
    }
    public get maxTtlSeconds(): number {
        return this._maxTtlSeconds;
    }
    public get cataloguePolicy(): string {
        return this._cataloguePolicy;
    }

    public toJSON(): Record<string, unknown> {
        return {
            contentMode: this._contentMode,
            searchModes: this._searchModes,
            metadataOnlySearch: this._metadataOnlySearch,
            chunkBytes: this._chunkBytes,
            maxListLimit: this._maxListLimit,
            maxRequestBodyBytes: this._maxRequestBodyBytes,
            maxFileBytes: this._maxFileBytes,
            maxArtifactBytes: this._maxArtifactBytes,
            maxFilesPerArtifact: this._maxFilesPerArtifact,
            maxTtlSeconds: this._maxTtlSeconds,
            cataloguePolicy: this._cataloguePolicy
        };
    }

    public with(overrides: {contentMode?: ContentMode; searchModes?: Array<SearchMode>; metadataOnlySearch?: boolean; chunkBytes?: number; maxListLimit?: number; maxRequestBodyBytes?: bigint; maxFileBytes?: bigint; maxArtifactBytes?: bigint; maxFilesPerArtifact?: number; maxTtlSeconds?: number; cataloguePolicy?: string}): Capabilities {
        return new Capabilities(
            'contentMode' in overrides ? overrides.contentMode! : this._contentMode,
            'searchModes' in overrides ? overrides.searchModes! : this._searchModes,
            'metadataOnlySearch' in overrides ? overrides.metadataOnlySearch! : this._metadataOnlySearch,
            'chunkBytes' in overrides ? overrides.chunkBytes! : this._chunkBytes,
            'maxListLimit' in overrides ? overrides.maxListLimit! : this._maxListLimit,
            'maxRequestBodyBytes' in overrides ? overrides.maxRequestBodyBytes! : this._maxRequestBodyBytes,
            'maxFileBytes' in overrides ? overrides.maxFileBytes! : this._maxFileBytes,
            'maxArtifactBytes' in overrides ? overrides.maxArtifactBytes! : this._maxArtifactBytes,
            'maxFilesPerArtifact' in overrides ? overrides.maxFilesPerArtifact! : this._maxFilesPerArtifact,
            'maxTtlSeconds' in overrides ? overrides.maxTtlSeconds! : this._maxTtlSeconds,
            'cataloguePolicy' in overrides ? overrides.cataloguePolicy! : this._cataloguePolicy
        );
    }

    public static fromPlain(obj: {contentMode: ContentMode; searchModes: Array<SearchMode>; metadataOnlySearch: boolean; chunkBytes: number; maxListLimit: number; maxRequestBodyBytes: bigint; maxFileBytes: bigint; maxArtifactBytes: bigint; maxFilesPerArtifact: number; maxTtlSeconds: number; cataloguePolicy: string}): Capabilities {
        return new Capabilities(
            obj.contentMode,
            obj.searchModes,
            obj.metadataOnlySearch,
            obj.chunkBytes,
            obj.maxListLimit,
            obj.maxRequestBodyBytes,
            obj.maxFileBytes,
            obj.maxArtifactBytes,
            obj.maxFilesPerArtifact,
            obj.maxTtlSeconds,
            obj.cataloguePolicy
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Capabilities.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Capabilities.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Capabilities'
    public baboonTypeIdentifier() {
        return Capabilities.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Capabilities.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Capabilities.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Capabilities.BaboonMinReaderVersions
    }
    public static jsonCodec(): Capabilities_JsonCodec {
        return Capabilities_JsonCodec.instance
    }
}

export class Capabilities_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Capabilities): unknown {
        if (this !== Capabilities_JsonCodec.lazyInstance.value) {
          return Capabilities_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "contentMode": ContentMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contentMode),
            "searchModes": Array.from(value.searchModes).map(item => SearchMode_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "metadataOnlySearch": value.metadataOnlySearch,
            "chunkBytes": value.chunkBytes,
            "maxListLimit": value.maxListLimit,
            "maxRequestBodyBytes": value.maxRequestBodyBytes.toString(),
            "maxFileBytes": value.maxFileBytes.toString(),
            "maxArtifactBytes": value.maxArtifactBytes.toString(),
            "maxFilesPerArtifact": value.maxFilesPerArtifact,
            "maxTtlSeconds": value.maxTtlSeconds,
            "cataloguePolicy": value.cataloguePolicy,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Capabilities {
        if (this !== Capabilities_JsonCodec .lazyInstance.value) {
            return Capabilities_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Capabilities (
            ContentMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contentMode"]),
            (obj["searchModes"] as unknown[]).map(item => SearchMode_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["metadataOnlySearch"] as boolean,
            obj["chunkBytes"] as number,
            obj["maxListLimit"] as number,
            BaboonInt64.read(obj["maxRequestBodyBytes"], "i64/u64"),
            BaboonInt64.read(obj["maxFileBytes"], "i64/u64"),
            BaboonInt64.read(obj["maxArtifactBytes"], "i64/u64"),
            obj["maxFilesPerArtifact"] as number,
            obj["maxTtlSeconds"] as number,
            obj["cataloguePolicy"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Capabilities_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Capabilities_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Capabilities'
    public baboonTypeIdentifier() {
        return Capabilities_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Capabilities_JsonCodec())
    public static get instance(): Capabilities_JsonCodec {
        return Capabilities_JsonCodec.lazyInstance.value
    }
}