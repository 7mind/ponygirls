import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {JobInfo, JobInfo_JsonCodec} from './JobInfo.js'
import {PassageFormat, PassageFormat_JsonCodec} from './PassageFormat.js'
import {SessionInfo, SessionInfo_JsonCodec} from './SessionInfo.js'

export class ArchiveRow implements BaboonGeneratedLatest {
    private readonly _head: SessionInfo;
    private readonly _publishedView: ContentView | undefined;
    private readonly _matchedView: ContentView | undefined;
    private readonly _lastTimestamp: string | undefined;
    private readonly _messageCount: number;
    private readonly _tags: Array<string>;
    private readonly _headJob: JobInfo | undefined;
    private readonly _publishedFormat: PassageFormat | undefined;

    constructor(head: SessionInfo, publishedView: ContentView | undefined, matchedView: ContentView | undefined, lastTimestamp: string | undefined, messageCount: number, tags: Array<string>, headJob: JobInfo | undefined, publishedFormat: PassageFormat | undefined) {
        this._head = head
        this._publishedView = publishedView
        this._matchedView = matchedView
        this._lastTimestamp = lastTimestamp
        this._messageCount = messageCount
        this._tags = tags
        this._headJob = headJob
        this._publishedFormat = publishedFormat
    }

    public get head(): SessionInfo {
        return this._head;
    }
    public get publishedView(): ContentView | undefined {
        return this._publishedView;
    }
    public get matchedView(): ContentView | undefined {
        return this._matchedView;
    }
    public get lastTimestamp(): string | undefined {
        return this._lastTimestamp;
    }
    public get messageCount(): number {
        return this._messageCount;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get headJob(): JobInfo | undefined {
        return this._headJob;
    }
    public get publishedFormat(): PassageFormat | undefined {
        return this._publishedFormat;
    }

    public toJSON(): Record<string, unknown> {
        return {
            head: this._head,
            publishedView: this._publishedView !== undefined ? this._publishedView : undefined,
            matchedView: this._matchedView !== undefined ? this._matchedView : undefined,
            lastTimestamp: this._lastTimestamp !== undefined ? this._lastTimestamp : undefined,
            messageCount: this._messageCount,
            tags: this._tags,
            headJob: this._headJob !== undefined ? this._headJob : undefined,
            publishedFormat: this._publishedFormat !== undefined ? this._publishedFormat : undefined
        };
    }

    public with(overrides: {head?: SessionInfo; publishedView?: ContentView | undefined; matchedView?: ContentView | undefined; lastTimestamp?: string | undefined; messageCount?: number; tags?: Array<string>; headJob?: JobInfo | undefined; publishedFormat?: PassageFormat | undefined}): ArchiveRow {
        return new ArchiveRow(
            'head' in overrides ? overrides.head! : this._head,
            'publishedView' in overrides ? overrides.publishedView! : this._publishedView,
            'matchedView' in overrides ? overrides.matchedView! : this._matchedView,
            'lastTimestamp' in overrides ? overrides.lastTimestamp! : this._lastTimestamp,
            'messageCount' in overrides ? overrides.messageCount! : this._messageCount,
            'tags' in overrides ? overrides.tags! : this._tags,
            'headJob' in overrides ? overrides.headJob! : this._headJob,
            'publishedFormat' in overrides ? overrides.publishedFormat! : this._publishedFormat
        );
    }

    public static fromPlain(obj: {head: SessionInfo; publishedView: ContentView | undefined; matchedView: ContentView | undefined; lastTimestamp: string | undefined; messageCount: number; tags: Array<string>; headJob: JobInfo | undefined; publishedFormat: PassageFormat | undefined}): ArchiveRow {
        return new ArchiveRow(
            obj.head,
            obj.publishedView,
            obj.matchedView,
            obj.lastTimestamp,
            obj.messageCount,
            obj.tags,
            obj.headJob,
            obj.publishedFormat
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return ArchiveRow.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveRow.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveRow'
    public baboonTypeIdentifier() {
        return ArchiveRow.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.5.0"]
    public baboonSameInVersions() {
        return ArchiveRow.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return ArchiveRow.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.5.0", "identical": "1.5.0" }
    public baboonMinReaderVersions() {
        return ArchiveRow.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArchiveRow_JsonCodec {
        return ArchiveRow_JsonCodec.instance
    }
}

export class ArchiveRow_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveRow): unknown {
        if (this !== ArchiveRow_JsonCodec.lazyInstance.value) {
          return ArchiveRow_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "head": SessionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.head),
            "publishedView": value.publishedView === undefined ? null : ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.publishedView),
            "matchedView": value.matchedView === undefined ? null : ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.matchedView),
            "lastTimestamp": value.lastTimestamp === undefined ? null : value.lastTimestamp,
            "messageCount": value.messageCount,
            "tags": Array.from(value.tags),
            "headJob": value.headJob === undefined ? null : JobInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.headJob),
            "publishedFormat": value.publishedFormat === undefined ? null : PassageFormat_JsonCodec.instance.encode(BaboonCodecContext.Default, value.publishedFormat),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveRow {
        if (this !== ArchiveRow_JsonCodec .lazyInstance.value) {
            return ArchiveRow_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArchiveRow (
            SessionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["head"]),
            obj["publishedView"] === undefined || obj["publishedView"] === null ? undefined : obj["publishedView"] === undefined || obj["publishedView"] === null ? undefined : ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["publishedView"]),
            obj["matchedView"] === undefined || obj["matchedView"] === null ? undefined : obj["matchedView"] === undefined || obj["matchedView"] === null ? undefined : ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["matchedView"]),
            obj["lastTimestamp"] === undefined || obj["lastTimestamp"] === null ? undefined : obj["lastTimestamp"] === undefined || obj["lastTimestamp"] === null ? undefined : obj["lastTimestamp"] as string,
            obj["messageCount"] as number,
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["headJob"] === undefined || obj["headJob"] === null ? undefined : obj["headJob"] === undefined || obj["headJob"] === null ? undefined : JobInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["headJob"]),
            obj["publishedFormat"] === undefined || obj["publishedFormat"] === null ? undefined : obj["publishedFormat"] === undefined || obj["publishedFormat"] === null ? undefined : PassageFormat_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["publishedFormat"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return ArchiveRow_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveRow_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveRow'
    public baboonTypeIdentifier() {
        return ArchiveRow_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveRow_JsonCodec())
    public static get instance(): ArchiveRow_JsonCodec {
        return ArchiveRow_JsonCodec.lazyInstance.value
    }
}