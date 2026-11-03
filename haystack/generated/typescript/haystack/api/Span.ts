import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Span implements BaboonGeneratedLatest {
    private readonly _message: string;
    private readonly _start: number;
    private readonly _end: number;

    constructor(message: string, start: number, end: number) {
        this._message = message
        this._start = start
        this._end = end
    }

    public get message(): string {
        return this._message;
    }
    public get start(): number {
        return this._start;
    }
    public get end(): number {
        return this._end;
    }

    public toJSON(): Record<string, unknown> {
        return {
            message: this._message,
            start: this._start,
            end: this._end
        };
    }

    public with(overrides: {message?: string; start?: number; end?: number}): Span {
        return new Span(
            'message' in overrides ? overrides.message! : this._message,
            'start' in overrides ? overrides.start! : this._start,
            'end' in overrides ? overrides.end! : this._end
        );
    }

    public static fromPlain(obj: {message: string; start: number; end: number}): Span {
        return new Span(
            obj.message,
            obj.start,
            obj.end
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Span.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Span.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Span'
    public baboonTypeIdentifier() {
        return Span.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Span.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Span.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Span.BaboonMinReaderVersions
    }
    public static jsonCodec(): Span_JsonCodec {
        return Span_JsonCodec.instance
    }
}

export class Span_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Span): unknown {
        if (this !== Span_JsonCodec.lazyInstance.value) {
          return Span_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "message": value.message,
            "start": value.start,
            "end": value.end,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Span {
        if (this !== Span_JsonCodec .lazyInstance.value) {
            return Span_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Span (
            obj["message"] as string,
            obj["start"] as number,
            obj["end"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Span_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Span_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Span'
    public baboonTypeIdentifier() {
        return Span_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Span_JsonCodec())
    public static get instance(): Span_JsonCodec {
        return Span_JsonCodec.lazyInstance.value
    }
}