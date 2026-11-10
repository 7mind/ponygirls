import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CapturedEvent, CapturedEvent_JsonCodec} from './CapturedEvent.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class GoverningChange implements BaboonGeneratedLatest {
    private readonly _previous: Ref;
    private readonly _current: Ref;
    private readonly _reason: string;
    private readonly _humanBasis: Array<CapturedEvent>;

    constructor(previous: Ref, current: Ref, reason: string, humanBasis: Array<CapturedEvent>) {
        this._previous = previous
        this._current = current
        this._reason = reason
        this._humanBasis = humanBasis
    }

    public get previous(): Ref {
        return this._previous;
    }
    public get current(): Ref {
        return this._current;
    }
    public get reason(): string {
        return this._reason;
    }
    public get humanBasis(): Array<CapturedEvent> {
        return this._humanBasis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            previous: this._previous,
            current: this._current,
            reason: this._reason,
            humanBasis: this._humanBasis
        };
    }

    public with(overrides: {previous?: Ref; current?: Ref; reason?: string; humanBasis?: Array<CapturedEvent>}): GoverningChange {
        return new GoverningChange(
            'previous' in overrides ? overrides.previous! : this._previous,
            'current' in overrides ? overrides.current! : this._current,
            'reason' in overrides ? overrides.reason! : this._reason,
            'humanBasis' in overrides ? overrides.humanBasis! : this._humanBasis
        );
    }

    public static fromPlain(obj: {previous: Ref; current: Ref; reason: string; humanBasis: Array<CapturedEvent>}): GoverningChange {
        return new GoverningChange(
            obj.previous,
            obj.current,
            obj.reason,
            obj.humanBasis
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GoverningChange.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GoverningChange.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GoverningChange'
    public baboonTypeIdentifier() {
        return GoverningChange.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GoverningChange.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GoverningChange.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GoverningChange.BaboonMinReaderVersions
    }
    public static jsonCodec(): GoverningChange_JsonCodec {
        return GoverningChange_JsonCodec.instance
    }
}

export class GoverningChange_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GoverningChange): unknown {
        if (this !== GoverningChange_JsonCodec.lazyInstance.value) {
          return GoverningChange_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "previous": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.previous),
            "current": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.current),
            "reason": value.reason,
            "humanBasis": Array.from(value.humanBasis).map(item => CapturedEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GoverningChange {
        if (this !== GoverningChange_JsonCodec .lazyInstance.value) {
            return GoverningChange_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GoverningChange (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["previous"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["current"]),
            obj["reason"] as string,
            (obj["humanBasis"] as unknown[]).map(item => CapturedEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GoverningChange_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GoverningChange_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GoverningChange'
    public baboonTypeIdentifier() {
        return GoverningChange_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GoverningChange_JsonCodec())
    public static get instance(): GoverningChange_JsonCodec {
        return GoverningChange_JsonCodec.lazyInstance.value
    }
}