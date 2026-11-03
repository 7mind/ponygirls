import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ExpiryChange, ExpiryChange_JsonCodec} from './ExpiryChange.js'
import {Visibility, Visibility_JsonCodec} from './Visibility.js'

export class ArtifactPatch implements BaboonGeneratedLatest {
    private readonly _name: string | undefined;
    private readonly _visibility: Visibility | undefined;
    private readonly _expiry: ExpiryChange;

    constructor(name: string | undefined, visibility: Visibility | undefined, expiry: ExpiryChange) {
        this._name = name
        this._visibility = visibility
        this._expiry = expiry
    }

    public get name(): string | undefined {
        return this._name;
    }
    public get visibility(): Visibility | undefined {
        return this._visibility;
    }
    public get expiry(): ExpiryChange {
        return this._expiry;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this._name !== undefined ? this._name : undefined,
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            expiry: this._expiry
        };
    }

    public with(overrides: {name?: string | undefined; visibility?: Visibility | undefined; expiry?: ExpiryChange}): ArtifactPatch {
        return new ArtifactPatch(
            'name' in overrides ? overrides.name! : this._name,
            'visibility' in overrides ? overrides.visibility! : this._visibility,
            'expiry' in overrides ? overrides.expiry! : this._expiry
        );
    }

    public static fromPlain(obj: {name: string | undefined; visibility: Visibility | undefined; expiry: ExpiryChange}): ArtifactPatch {
        return new ArtifactPatch(
            obj.name,
            obj.visibility,
            obj.expiry
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ArtifactPatch.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ArtifactPatch.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ArtifactPatch'
    public baboonTypeIdentifier() {
        return ArtifactPatch.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ArtifactPatch.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ArtifactPatch.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ArtifactPatch.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArtifactPatch_JsonCodec {
        return ArtifactPatch_JsonCodec.instance
    }
}

export class ArtifactPatch_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArtifactPatch): unknown {
        if (this !== ArtifactPatch_JsonCodec.lazyInstance.value) {
          return ArtifactPatch_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "name": value.name === undefined ? null : value.name,
            "visibility": value.visibility === undefined ? null : Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "expiry": ExpiryChange_JsonCodec.instance.encode(BaboonCodecContext.Default, value.expiry),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArtifactPatch {
        if (this !== ArtifactPatch_JsonCodec .lazyInstance.value) {
            return ArtifactPatch_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArtifactPatch (
            obj["name"] === undefined || obj["name"] === null ? undefined : obj["name"] === undefined || obj["name"] === null ? undefined : obj["name"] as string,
            obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]),
            ExpiryChange_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["expiry"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ArtifactPatch_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ArtifactPatch_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ArtifactPatch'
    public baboonTypeIdentifier() {
        return ArtifactPatch_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArtifactPatch_JsonCodec())
    public static get instance(): ArtifactPatch_JsonCodec {
        return ArtifactPatch_JsonCodec.lazyInstance.value
    }
}