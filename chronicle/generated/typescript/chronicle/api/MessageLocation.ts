import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'

export class MessageLocation implements BaboonGeneratedLatest {
    private readonly _view: ContentView;
    private readonly _position: number;
    private readonly _total: number;

    constructor(view: ContentView, position: number, total: number) {
        this._view = view
        this._position = position
        this._total = total
    }

    public get view(): ContentView {
        return this._view;
    }
    public get position(): number {
        return this._position;
    }
    public get total(): number {
        return this._total;
    }

    public toJSON(): Record<string, unknown> {
        return {
            view: this._view,
            position: this._position,
            total: this._total
        };
    }

    public with(overrides: {view?: ContentView; position?: number; total?: number}): MessageLocation {
        return new MessageLocation(
            'view' in overrides ? overrides.view! : this._view,
            'position' in overrides ? overrides.position! : this._position,
            'total' in overrides ? overrides.total! : this._total
        );
    }

    public static fromPlain(obj: {view: ContentView; position: number; total: number}): MessageLocation {
        return new MessageLocation(
            obj.view,
            obj.position,
            obj.total
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return MessageLocation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageLocation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageLocation'
    public baboonTypeIdentifier() {
        return MessageLocation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return MessageLocation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return MessageLocation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return MessageLocation.BaboonMinReaderVersions
    }
    public static jsonCodec(): MessageLocation_JsonCodec {
        return MessageLocation_JsonCodec.instance
    }
}

export class MessageLocation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: MessageLocation): unknown {
        if (this !== MessageLocation_JsonCodec.lazyInstance.value) {
          return MessageLocation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "position": value.position,
            "total": value.total,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): MessageLocation {
        if (this !== MessageLocation_JsonCodec .lazyInstance.value) {
            return MessageLocation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new MessageLocation (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            obj["position"] as number,
            obj["total"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return MessageLocation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageLocation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageLocation'
    public baboonTypeIdentifier() {
        return MessageLocation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new MessageLocation_JsonCodec())
    public static get instance(): MessageLocation_JsonCodec {
        return MessageLocation_JsonCodec.lazyInstance.value
    }
}