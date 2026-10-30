import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Span, Span_JsonCodec} from './Span.js'

export class Chunk implements BaboonGenerated {
    private readonly _id: string;
    private readonly _sessionId: string;
    private readonly _text: string;
    private readonly _summary: string;
    private readonly _tags: Array<string>;
    private readonly _spans: Array<Span>;
    private readonly _score: number;

    constructor(id: string, sessionId: string, text: string, summary: string, tags: Array<string>, spans: Array<Span>, score: number) {
        this._id = id
        this._sessionId = sessionId
        this._text = text
        this._summary = summary
        this._tags = tags
        this._spans = spans
        this._score = score
    }

    public get id(): string {
        return this._id;
    }
    public get sessionId(): string {
        return this._sessionId;
    }
    public get text(): string {
        return this._text;
    }
    public get summary(): string {
        return this._summary;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get spans(): Array<Span> {
        return this._spans;
    }
    public get score(): number {
        return this._score;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            sessionId: this._sessionId,
            text: this._text,
            summary: this._summary,
            tags: this._tags,
            spans: this._spans,
            score: this._score
        };
    }

    public with(overrides: {id?: string; sessionId?: string; text?: string; summary?: string; tags?: Array<string>; spans?: Array<Span>; score?: number}): Chunk {
        return new Chunk(
            'id' in overrides ? overrides.id! : this._id,
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'text' in overrides ? overrides.text! : this._text,
            'summary' in overrides ? overrides.summary! : this._summary,
            'tags' in overrides ? overrides.tags! : this._tags,
            'spans' in overrides ? overrides.spans! : this._spans,
            'score' in overrides ? overrides.score! : this._score
        );
    }

    public static fromPlain(obj: {id: string; sessionId: string; text: string; summary: string; tags: Array<string>; spans: Array<Span>; score: number}): Chunk {
        return new Chunk(
            obj.id,
            obj.sessionId,
            obj.text,
            obj.summary,
            obj.tags,
            obj.spans,
            obj.score
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Chunk.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Chunk.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Chunk'
    public baboonTypeIdentifier() {
        return Chunk.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return Chunk.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return Chunk.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Chunk.BaboonMinReaderVersions
    }
    public static jsonCodec(): Chunk_JsonCodec {
        return Chunk_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.8.0 */
export class Chunk_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Chunk): unknown {
        if (this !== Chunk_JsonCodec.lazyInstance.value) {
          return Chunk_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "sessionId": value.sessionId,
            "text": value.text,
            "summary": value.summary,
            "tags": Array.from(value.tags),
            "spans": Array.from(value.spans).map(item => Span_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "score": value.score,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Chunk {
        if (this !== Chunk_JsonCodec .lazyInstance.value) {
            return Chunk_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Chunk (
            obj["id"] as string,
            obj["sessionId"] as string,
            obj["text"] as string,
            obj["summary"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            (obj["spans"] as unknown[]).map(item => Span_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["score"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Chunk_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Chunk_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Chunk'
    public baboonTypeIdentifier() {
        return Chunk_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Chunk_JsonCodec())
    public static get instance(): Chunk_JsonCodec {
        return Chunk_JsonCodec.lazyInstance.value
    }
}