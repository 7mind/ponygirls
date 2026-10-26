import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {Message, Message_JsonCodec} from './Message.js'

export class MessagesResult implements BaboonGeneratedLatest {
    private readonly _messages: Array<Message>;
    private readonly _total: number;
    private readonly _offset: number;
    private readonly _view: ContentView;

    constructor(messages: Array<Message>, total: number, offset: number, view: ContentView) {
        this._messages = messages
        this._total = total
        this._offset = offset
        this._view = view
    }

    public get messages(): Array<Message> {
        return this._messages;
    }
    public get total(): number {
        return this._total;
    }
    public get offset(): number {
        return this._offset;
    }
    public get view(): ContentView {
        return this._view;
    }

    public toJSON(): Record<string, unknown> {
        return {
            messages: this._messages,
            total: this._total,
            offset: this._offset,
            view: this._view
        };
    }

    public with(overrides: {messages?: Array<Message>; total?: number; offset?: number; view?: ContentView}): MessagesResult {
        return new MessagesResult(
            'messages' in overrides ? overrides.messages! : this._messages,
            'total' in overrides ? overrides.total! : this._total,
            'offset' in overrides ? overrides.offset! : this._offset,
            'view' in overrides ? overrides.view! : this._view
        );
    }

    public static fromPlain(obj: {messages: Array<Message>; total: number; offset: number; view: ContentView}): MessagesResult {
        return new MessagesResult(
            obj.messages,
            obj.total,
            obj.offset,
            obj.view
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return MessagesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessagesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessagesResult'
    public baboonTypeIdentifier() {
        return MessagesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return MessagesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return MessagesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return MessagesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): MessagesResult_JsonCodec {
        return MessagesResult_JsonCodec.instance
    }
}

export class MessagesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: MessagesResult): unknown {
        if (this !== MessagesResult_JsonCodec.lazyInstance.value) {
          return MessagesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "messages": Array.from(value.messages).map(item => Message_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total,
            "offset": value.offset,
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): MessagesResult {
        if (this !== MessagesResult_JsonCodec .lazyInstance.value) {
            return MessagesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new MessagesResult (
            (obj["messages"] as unknown[]).map(item => Message_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["total"] as number,
            obj["offset"] as number,
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return MessagesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessagesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessagesResult'
    public baboonTypeIdentifier() {
        return MessagesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new MessagesResult_JsonCodec())
    public static get instance(): MessagesResult_JsonCodec {
        return MessagesResult_JsonCodec.lazyInstance.value
    }
}