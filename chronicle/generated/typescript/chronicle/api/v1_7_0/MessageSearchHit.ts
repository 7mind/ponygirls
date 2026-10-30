import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class MessageSearchHit implements BaboonGenerated {
    private readonly _messageId: string;
    private readonly _position: number;

    constructor(messageId: string, position: number) {
        this._messageId = messageId
        this._position = position
    }

    public get messageId(): string {
        return this._messageId;
    }
    public get position(): number {
        return this._position;
    }

    public toJSON(): Record<string, unknown> {
        return {
            messageId: this._messageId,
            position: this._position
        };
    }

    public with(overrides: {messageId?: string; position?: number}): MessageSearchHit {
        return new MessageSearchHit(
            'messageId' in overrides ? overrides.messageId! : this._messageId,
            'position' in overrides ? overrides.position! : this._position
        );
    }

    public static fromPlain(obj: {messageId: string; position: number}): MessageSearchHit {
        return new MessageSearchHit(
            obj.messageId,
            obj.position
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return MessageSearchHit.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageSearchHit.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageSearchHit'
    public baboonTypeIdentifier() {
        return MessageSearchHit.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return MessageSearchHit.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return MessageSearchHit.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.6.0", "prefix-compact": "1.6.0", "prefix-any-mode": "1.6.0", "identical": "1.6.0" }
    public baboonMinReaderVersions() {
        return MessageSearchHit.BaboonMinReaderVersions
    }
    public static jsonCodec(): MessageSearchHit_JsonCodec {
        return MessageSearchHit_JsonCodec.instance
    }
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class MessageSearchHit_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: MessageSearchHit): unknown {
        if (this !== MessageSearchHit_JsonCodec.lazyInstance.value) {
          return MessageSearchHit_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "messageId": value.messageId,
            "position": value.position,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): MessageSearchHit {
        if (this !== MessageSearchHit_JsonCodec .lazyInstance.value) {
            return MessageSearchHit_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new MessageSearchHit (
            obj["messageId"] as string,
            obj["position"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return MessageSearchHit_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageSearchHit_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageSearchHit'
    public baboonTypeIdentifier() {
        return MessageSearchHit_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new MessageSearchHit_JsonCodec())
    public static get instance(): MessageSearchHit_JsonCodec {
        return MessageSearchHit_JsonCodec.lazyInstance.value
    }
}