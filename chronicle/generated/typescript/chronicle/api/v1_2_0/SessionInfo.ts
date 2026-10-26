import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Completion, Completion_JsonCodec} from './Completion.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {Metadata, Metadata_JsonCodec} from './Metadata.js'
import {SourceIdentity, SourceIdentity_JsonCodec} from './SourceIdentity.js'

export class SessionInfo implements BaboonGenerated {
    private readonly _view: ContentView;
    private readonly _id: string;
    private readonly _ownerId: string;
    private readonly _revision: number;
    private readonly _indexedRevision: number | undefined;
    private readonly _metadata: Metadata;
    private readonly _source: SourceIdentity;
    private readonly _completion: Completion;
    private readonly _redacted: boolean;

    constructor(view: ContentView, id: string, ownerId: string, revision: number, indexedRevision: number | undefined, metadata: Metadata, source: SourceIdentity, completion: Completion, redacted: boolean) {
        this._view = view
        this._id = id
        this._ownerId = ownerId
        this._revision = revision
        this._indexedRevision = indexedRevision
        this._metadata = metadata
        this._source = source
        this._completion = completion
        this._redacted = redacted
    }

    public get view(): ContentView {
        return this._view;
    }
    public get id(): string {
        return this._id;
    }
    public get ownerId(): string {
        return this._ownerId;
    }
    public get revision(): number {
        return this._revision;
    }
    public get indexedRevision(): number | undefined {
        return this._indexedRevision;
    }
    public get metadata(): Metadata {
        return this._metadata;
    }
    public get source(): SourceIdentity {
        return this._source;
    }
    public get completion(): Completion {
        return this._completion;
    }
    public get redacted(): boolean {
        return this._redacted;
    }

    public toJSON(): Record<string, unknown> {
        return {
            view: this._view,
            id: this._id,
            ownerId: this._ownerId,
            revision: this._revision,
            indexedRevision: this._indexedRevision !== undefined ? this._indexedRevision : undefined,
            metadata: this._metadata,
            source: this._source,
            completion: this._completion,
            redacted: this._redacted
        };
    }

    public with(overrides: {view?: ContentView; id?: string; ownerId?: string; revision?: number; indexedRevision?: number | undefined; metadata?: Metadata; source?: SourceIdentity; completion?: Completion; redacted?: boolean}): SessionInfo {
        return new SessionInfo(
            'view' in overrides ? overrides.view! : this._view,
            'id' in overrides ? overrides.id! : this._id,
            'ownerId' in overrides ? overrides.ownerId! : this._ownerId,
            'revision' in overrides ? overrides.revision! : this._revision,
            'indexedRevision' in overrides ? overrides.indexedRevision! : this._indexedRevision,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'source' in overrides ? overrides.source! : this._source,
            'completion' in overrides ? overrides.completion! : this._completion,
            'redacted' in overrides ? overrides.redacted! : this._redacted
        );
    }

    public static fromPlain(obj: {view: ContentView; id: string; ownerId: string; revision: number; indexedRevision: number | undefined; metadata: Metadata; source: SourceIdentity; completion: Completion; redacted: boolean}): SessionInfo {
        return new SessionInfo(
            obj.view,
            obj.id,
            obj.ownerId,
            obj.revision,
            obj.indexedRevision,
            obj.metadata,
            obj.source,
            obj.completion,
            obj.redacted
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SessionInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionInfo'
    public baboonTypeIdentifier() {
        return SessionInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return SessionInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return SessionInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SessionInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): SessionInfo_JsonCodec {
        return SessionInfo_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.4.0 */
export class SessionInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SessionInfo): unknown {
        if (this !== SessionInfo_JsonCodec.lazyInstance.value) {
          return SessionInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "id": value.id,
            "ownerId": value.ownerId,
            "revision": value.revision,
            "indexedRevision": value.indexedRevision === undefined ? null : value.indexedRevision,
            "metadata": Metadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
            "source": SourceIdentity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "completion": Completion_JsonCodec.instance.encode(BaboonCodecContext.Default, value.completion),
            "redacted": value.redacted,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SessionInfo {
        if (this !== SessionInfo_JsonCodec .lazyInstance.value) {
            return SessionInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SessionInfo (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            obj["id"] as string,
            obj["ownerId"] as string,
            obj["revision"] as number,
            obj["indexedRevision"] === undefined || obj["indexedRevision"] === null ? undefined : obj["indexedRevision"] === undefined || obj["indexedRevision"] === null ? undefined : obj["indexedRevision"] as number,
            Metadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
            SourceIdentity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            Completion_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["completion"]),
            obj["redacted"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SessionInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionInfo'
    public baboonTypeIdentifier() {
        return SessionInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SessionInfo_JsonCodec())
    public static get instance(): SessionInfo_JsonCodec {
        return SessionInfo_JsonCodec.lazyInstance.value
    }
}