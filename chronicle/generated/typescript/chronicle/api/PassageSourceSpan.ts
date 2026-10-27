import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class PassageSourceSpan implements BaboonGeneratedLatest {
    private readonly _messageId: string;
    private readonly _messagePosition: number;
    private readonly _start: number;
    private readonly _end: number;

    constructor(messageId: string, messagePosition: number, start: number, end: number) {
        this._messageId = messageId
        this._messagePosition = messagePosition
        this._start = start
        this._end = end
    }

    public get messageId(): string {
        return this._messageId;
    }
    public get messagePosition(): number {
        return this._messagePosition;
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
            messagePosition: this._messagePosition,
            start: this._start,
            end: this._end
        };
    }

    public with(overrides: {messageId?: string; messagePosition?: number; start?: number; end?: number}): PassageSourceSpan {
        return new PassageSourceSpan(
            'messageId' in overrides ? overrides.messageId! : this._messageId,
            'messagePosition' in overrides ? overrides.messagePosition! : this._messagePosition,
            'start' in overrides ? overrides.start! : this._start,
            'end' in overrides ? overrides.end! : this._end
        );
    }

    public static fromPlain(obj: {messageId: string; messagePosition: number; start: number; end: number}): PassageSourceSpan {
        return new PassageSourceSpan(
            obj.messageId,
            obj.messagePosition,
            obj.start,
            obj.end
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassageSourceSpan.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageSourceSpan.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageSourceSpan'
    public baboonTypeIdentifier() {
        return PassageSourceSpan.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return PassageSourceSpan.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return PassageSourceSpan.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return PassageSourceSpan.BaboonMinReaderVersions
    }
    public static jsonCodec(): PassageSourceSpan_JsonCodec {
        return PassageSourceSpan_JsonCodec.instance
    }
}

export class PassageSourceSpan_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassageSourceSpan): unknown {
        if (this !== PassageSourceSpan_JsonCodec.lazyInstance.value) {
          return PassageSourceSpan_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "messageId": value.messageId,
            "messagePosition": value.messagePosition,
            "start": value.start,
            "end": value.end,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassageSourceSpan {
        if (this !== PassageSourceSpan_JsonCodec .lazyInstance.value) {
            return PassageSourceSpan_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PassageSourceSpan (
            obj["messageId"] as string,
            obj["messagePosition"] as number,
            obj["start"] as number,
            obj["end"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassageSourceSpan_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageSourceSpan_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageSourceSpan'
    public baboonTypeIdentifier() {
        return PassageSourceSpan_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassageSourceSpan_JsonCodec())
    public static get instance(): PassageSourceSpan_JsonCodec {
        return PassageSourceSpan_JsonCodec.lazyInstance.value
    }
}