import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Metadata implements BaboonGeneratedLatest {
    private readonly _createdAt: string;
    private readonly _createdBy: string;
    private readonly _modifiedAt: string;
    private readonly _modifiedBy: string;

    constructor(createdAt: string, createdBy: string, modifiedAt: string, modifiedBy: string) {
        this._createdAt = createdAt
        this._createdBy = createdBy
        this._modifiedAt = modifiedAt
        this._modifiedBy = modifiedBy
    }

    public get createdAt(): string {
        return this._createdAt;
    }
    public get createdBy(): string {
        return this._createdBy;
    }
    public get modifiedAt(): string {
        return this._modifiedAt;
    }
    public get modifiedBy(): string {
        return this._modifiedBy;
    }

    public toJSON(): Record<string, unknown> {
        return {
            createdAt: this._createdAt,
            createdBy: this._createdBy,
            modifiedAt: this._modifiedAt,
            modifiedBy: this._modifiedBy
        };
    }

    public with(overrides: {createdAt?: string; createdBy?: string; modifiedAt?: string; modifiedBy?: string}): Metadata {
        return new Metadata(
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'createdBy' in overrides ? overrides.createdBy! : this._createdBy,
            'modifiedAt' in overrides ? overrides.modifiedAt! : this._modifiedAt,
            'modifiedBy' in overrides ? overrides.modifiedBy! : this._modifiedBy
        );
    }

    public static fromPlain(obj: {createdAt: string; createdBy: string; modifiedAt: string; modifiedBy: string}): Metadata {
        return new Metadata(
            obj.createdAt,
            obj.createdBy,
            obj.modifiedAt,
            obj.modifiedBy
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Metadata.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Metadata.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Metadata'
    public baboonTypeIdentifier() {
        return Metadata.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Metadata.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Metadata.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Metadata.BaboonMinReaderVersions
    }
    public static jsonCodec(): Metadata_JsonCodec {
        return Metadata_JsonCodec.instance
    }
}

export class Metadata_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Metadata): unknown {
        if (this !== Metadata_JsonCodec.lazyInstance.value) {
          return Metadata_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "createdAt": value.createdAt,
            "createdBy": value.createdBy,
            "modifiedAt": value.modifiedAt,
            "modifiedBy": value.modifiedBy,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Metadata {
        if (this !== Metadata_JsonCodec .lazyInstance.value) {
            return Metadata_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Metadata (
            obj["createdAt"] as string,
            obj["createdBy"] as string,
            obj["modifiedAt"] as string,
            obj["modifiedBy"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Metadata_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Metadata_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Metadata'
    public baboonTypeIdentifier() {
        return Metadata_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Metadata_JsonCodec())
    public static get instance(): Metadata_JsonCodec {
        return Metadata_JsonCodec.lazyInstance.value
    }
}