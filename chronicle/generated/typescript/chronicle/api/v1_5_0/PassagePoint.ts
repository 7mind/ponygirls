import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class PassagePoint implements BaboonGenerated {
    private readonly _messageId: string;
    private readonly _messagePosition: number;
    private readonly _byteOffset: number;

    constructor(messageId: string, messagePosition: number, byteOffset: number) {
        this._messageId = messageId
        this._messagePosition = messagePosition
        this._byteOffset = byteOffset
    }

    public get messageId(): string {
        return this._messageId;
    }
    public get messagePosition(): number {
        return this._messagePosition;
    }
    public get byteOffset(): number {
        return this._byteOffset;
    }

    public toJSON(): Record<string, unknown> {
        return {
            messageId: this._messageId,
            messagePosition: this._messagePosition,
            byteOffset: this._byteOffset
        };
    }

    public with(overrides: {messageId?: string; messagePosition?: number; byteOffset?: number}): PassagePoint {
        return new PassagePoint(
            'messageId' in overrides ? overrides.messageId! : this._messageId,
            'messagePosition' in overrides ? overrides.messagePosition! : this._messagePosition,
            'byteOffset' in overrides ? overrides.byteOffset! : this._byteOffset
        );
    }

    public static fromPlain(obj: {messageId: string; messagePosition: number; byteOffset: number}): PassagePoint {
        return new PassagePoint(
            obj.messageId,
            obj.messagePosition,
            obj.byteOffset
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassagePoint.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassagePoint.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassagePoint'
    public baboonTypeIdentifier() {
        return PassagePoint.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return PassagePoint.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return PassagePoint.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return PassagePoint.BaboonMinReaderVersions
    }
    public static jsonCodec(): PassagePoint_JsonCodec {
        return PassagePoint_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class PassagePoint_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassagePoint): unknown {
        if (this !== PassagePoint_JsonCodec.lazyInstance.value) {
          return PassagePoint_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "messageId": value.messageId,
            "messagePosition": value.messagePosition,
            "byteOffset": value.byteOffset,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassagePoint {
        if (this !== PassagePoint_JsonCodec .lazyInstance.value) {
            return PassagePoint_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PassagePoint (
            obj["messageId"] as string,
            obj["messagePosition"] as number,
            obj["byteOffset"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassagePoint_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassagePoint_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassagePoint'
    public baboonTypeIdentifier() {
        return PassagePoint_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassagePoint_JsonCodec())
    public static get instance(): PassagePoint_JsonCodec {
        return PassagePoint_JsonCodec.lazyInstance.value
    }
}