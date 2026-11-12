import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CapsuleChange implements BaboonGeneratedLatest {
    private readonly _previous: Ref | undefined;
    private readonly _current: Ref | undefined;
    private readonly _account: Ref;
    private readonly _reason: string | undefined;
    private readonly _basis: Array<Ref>;
    private readonly _humanBasis: Array<Ref>;

    constructor(previous: Ref | undefined, current: Ref | undefined, account: Ref, reason: string | undefined, basis: Array<Ref>, humanBasis: Array<Ref>) {
        this._previous = previous
        this._current = current
        this._account = account
        this._reason = reason
        this._basis = basis
        this._humanBasis = humanBasis
    }

    public get previous(): Ref | undefined {
        return this._previous;
    }
    public get current(): Ref | undefined {
        return this._current;
    }
    public get account(): Ref {
        return this._account;
    }
    public get reason(): string | undefined {
        return this._reason;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }
    public get humanBasis(): Array<Ref> {
        return this._humanBasis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            previous: this._previous !== undefined ? this._previous : undefined,
            current: this._current !== undefined ? this._current : undefined,
            account: this._account,
            reason: this._reason !== undefined ? this._reason : undefined,
            basis: this._basis,
            humanBasis: this._humanBasis
        };
    }

    public with(overrides: {previous?: Ref | undefined; current?: Ref | undefined; account?: Ref; reason?: string | undefined; basis?: Array<Ref>; humanBasis?: Array<Ref>}): CapsuleChange {
        return new CapsuleChange(
            'previous' in overrides ? overrides.previous! : this._previous,
            'current' in overrides ? overrides.current! : this._current,
            'account' in overrides ? overrides.account! : this._account,
            'reason' in overrides ? overrides.reason! : this._reason,
            'basis' in overrides ? overrides.basis! : this._basis,
            'humanBasis' in overrides ? overrides.humanBasis! : this._humanBasis
        );
    }

    public static fromPlain(obj: {previous: Ref | undefined; current: Ref | undefined; account: Ref; reason: string | undefined; basis: Array<Ref>; humanBasis: Array<Ref>}): CapsuleChange {
        return new CapsuleChange(
            obj.previous,
            obj.current,
            obj.account,
            obj.reason,
            obj.basis,
            obj.humanBasis
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleChange.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleChange.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleChange'
    public baboonTypeIdentifier() {
        return CapsuleChange.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleChange.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleChange.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleChange.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleChange_JsonCodec {
        return CapsuleChange_JsonCodec.instance
    }
}

export class CapsuleChange_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleChange): unknown {
        if (this !== CapsuleChange_JsonCodec.lazyInstance.value) {
          return CapsuleChange_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "previous": value.previous === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.previous),
            "current": value.current === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.current),
            "account": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.account),
            "reason": value.reason === undefined ? null : value.reason,
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "humanBasis": Array.from(value.humanBasis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleChange {
        if (this !== CapsuleChange_JsonCodec .lazyInstance.value) {
            return CapsuleChange_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleChange (
            obj["previous"] === undefined || obj["previous"] === null ? undefined : obj["previous"] === undefined || obj["previous"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["previous"]),
            obj["current"] === undefined || obj["current"] === null ? undefined : obj["current"] === undefined || obj["current"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["current"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["account"]),
            obj["reason"] === undefined || obj["reason"] === null ? undefined : obj["reason"] === undefined || obj["reason"] === null ? undefined : obj["reason"] as string,
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["humanBasis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleChange_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleChange_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleChange'
    public baboonTypeIdentifier() {
        return CapsuleChange_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleChange_JsonCodec())
    public static get instance(): CapsuleChange_JsonCodec {
        return CapsuleChange_JsonCodec.lazyInstance.value
    }
}