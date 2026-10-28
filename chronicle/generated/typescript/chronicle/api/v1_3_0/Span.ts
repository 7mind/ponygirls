import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class Span implements BaboonGenerated {
    private readonly _messageId: string;
    private readonly _start: number;
    private readonly _end: number;

    constructor(messageId: string, start: number, end: number) {
        this._messageId = messageId
        this._start = start
        this._end = end
    }

    public get messageId(): string {
        return this._messageId;
    }
    public get start(): number {
        return this._start;
    }
    public get end(): number {
        return this._end;
    }

    public toJSON(): Record<string, unknown> {
        return {
            messageId: this._messageId,
            start: this._start,
            end: this._end
        };
    }

    public with(overrides: {messageId?: string; start?: number; end?: number}): Span {
        return new Span(
            'messageId' in overrides ? overrides.messageId! : this._messageId,
            'start' in overrides ? overrides.start! : this._start,
            'end' in overrides ? overrides.end! : this._end
        );
    }

    public static fromPlain(obj: {messageId: string; start: number; end: number}): Span {
        return new Span(
            obj.messageId,
            obj.start,
            obj.end
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Span.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Span.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Span'
    public baboonTypeIdentifier() {
        return Span.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return Span.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
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

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.7.0 */
export class Span_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Span): unknown {
        if (this !== Span_JsonCodec.lazyInstance.value) {
          return Span_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "messageId": value.messageId,
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
            obj["messageId"] as string,
            obj["start"] as number,
            obj["end"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Span_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Span_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Span'
    public baboonTypeIdentifier() {
        return Span_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Span_JsonCodec())
    public static get instance(): Span_JsonCodec {
        return Span_JsonCodec.lazyInstance.value
    }
}