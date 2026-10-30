import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class ContentView implements BaboonGenerated {
    private readonly _revision: number;
    private readonly _generationId: string | undefined;

    constructor(revision: number, generationId: string | undefined) {
        this._revision = revision
        this._generationId = generationId
    }

    public get revision(): number {
        return this._revision;
    }
    public get generationId(): string | undefined {
        return this._generationId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            revision: this._revision,
            generationId: this._generationId !== undefined ? this._generationId : undefined
        };
    }

    public with(overrides: {revision?: number; generationId?: string | undefined}): ContentView {
        return new ContentView(
            'revision' in overrides ? overrides.revision! : this._revision,
            'generationId' in overrides ? overrides.generationId! : this._generationId
        );
    }

    public static fromPlain(obj: {revision: number; generationId: string | undefined}): ContentView {
        return new ContentView(
            obj.revision,
            obj.generationId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ContentView.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ContentView.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ContentView'
    public baboonTypeIdentifier() {
        return ContentView.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return ContentView.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return ContentView.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentView.BaboonMinReaderVersions
    }
    public static jsonCodec(): ContentView_JsonCodec {
        return ContentView_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.8.0 */
export class ContentView_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentView): unknown {
        if (this !== ContentView_JsonCodec.lazyInstance.value) {
          return ContentView_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "revision": value.revision,
            "generationId": value.generationId === undefined ? null : value.generationId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentView {
        if (this !== ContentView_JsonCodec .lazyInstance.value) {
            return ContentView_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentView (
            obj["revision"] as number,
            obj["generationId"] === undefined || obj["generationId"] === null ? undefined : obj["generationId"] === undefined || obj["generationId"] === null ? undefined : obj["generationId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ContentView_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ContentView_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ContentView'
    public baboonTypeIdentifier() {
        return ContentView_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentView_JsonCodec())
    public static get instance(): ContentView_JsonCodec {
        return ContentView_JsonCodec.lazyInstance.value
    }
}