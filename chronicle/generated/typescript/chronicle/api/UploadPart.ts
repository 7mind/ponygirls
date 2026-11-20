import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Message, Message_JsonCodec} from './Message.js'

export class UploadPart implements BaboonGeneratedLatest {
    private readonly _ordinal: number;
    private readonly _sha256: string;
    private readonly _raw: string;
    private readonly _messages: Array<Message>;

    constructor(ordinal: number, sha256: string, raw: string, messages: Array<Message>) {
        this._ordinal = ordinal
        this._sha256 = sha256
        this._raw = raw
        this._messages = messages
    }

    public get ordinal(): number {
        return this._ordinal;
    }
    public get sha256(): string {
        return this._sha256;
    }
    public get raw(): string {
        return this._raw;
    }
    public get messages(): Array<Message> {
        return this._messages;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ordinal: this._ordinal,
            sha256: this._sha256,
            raw: this._raw,
            messages: this._messages
        };
    }

    public with(overrides: {ordinal?: number; sha256?: string; raw?: string; messages?: Array<Message>}): UploadPart {
        return new UploadPart(
            'ordinal' in overrides ? overrides.ordinal! : this._ordinal,
            'sha256' in overrides ? overrides.sha256! : this._sha256,
            'raw' in overrides ? overrides.raw! : this._raw,
            'messages' in overrides ? overrides.messages! : this._messages
        );
    }

    public static fromPlain(obj: {ordinal: number; sha256: string; raw: string; messages: Array<Message>}): UploadPart {
        return new UploadPart(
            obj.ordinal,
            obj.sha256,
            obj.raw,
            obj.messages
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadPart.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadPart.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadPart'
    public baboonTypeIdentifier() {
        return UploadPart.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return UploadPart.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return UploadPart.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return UploadPart.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadPart_JsonCodec {
        return UploadPart_JsonCodec.instance
    }
}

export class UploadPart_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadPart): unknown {
        if (this !== UploadPart_JsonCodec.lazyInstance.value) {
          return UploadPart_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ordinal": value.ordinal,
            "sha256": value.sha256,
            "raw": value.raw,
            "messages": Array.from(value.messages).map(item => Message_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadPart {
        if (this !== UploadPart_JsonCodec .lazyInstance.value) {
            return UploadPart_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadPart (
            obj["ordinal"] as number,
            obj["sha256"] as string,
            obj["raw"] as string,
            (obj["messages"] as unknown[]).map(item => Message_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadPart_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadPart_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadPart'
    public baboonTypeIdentifier() {
        return UploadPart_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadPart_JsonCodec())
    public static get instance(): UploadPart_JsonCodec {
        return UploadPart_JsonCodec.lazyInstance.value
    }
}