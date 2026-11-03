import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class DocumentPayload implements BaboonGeneratedLatest {
    private readonly _json: string;

    constructor(json: string) {
        this._json = json
    }

    public get json(): string {
        return this._json;
    }

    public toJSON(): Record<string, unknown> {
        return {
            json: this._json
        };
    }

    public with(overrides: {json?: string}): DocumentPayload {
        return new DocumentPayload(
            'json' in overrides ? overrides.json! : this._json
        );
    }

    public static fromPlain(obj: {json: string}): DocumentPayload {
        return new DocumentPayload(
            obj.json
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return DocumentPayload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return DocumentPayload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#DocumentPayload'
    public baboonTypeIdentifier() {
        return DocumentPayload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return DocumentPayload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return DocumentPayload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return DocumentPayload.BaboonMinReaderVersions
    }
    public static jsonCodec(): DocumentPayload_JsonCodec {
        return DocumentPayload_JsonCodec.instance
    }
}

export class DocumentPayload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DocumentPayload): unknown {
        if (this !== DocumentPayload_JsonCodec.lazyInstance.value) {
          return DocumentPayload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "json": value.json,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DocumentPayload {
        if (this !== DocumentPayload_JsonCodec .lazyInstance.value) {
            return DocumentPayload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DocumentPayload (
            obj["json"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return DocumentPayload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return DocumentPayload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#DocumentPayload'
    public baboonTypeIdentifier() {
        return DocumentPayload_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DocumentPayload_JsonCodec())
    public static get instance(): DocumentPayload_JsonCodec {
        return DocumentPayload_JsonCodec.lazyInstance.value
    }
}