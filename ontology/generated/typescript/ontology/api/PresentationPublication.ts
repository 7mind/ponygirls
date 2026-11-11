import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class PresentationPublication implements BaboonGeneratedLatest {
    private readonly _presentationId: string;
    private readonly _reservedSourceRef: Ref;
    private readonly _payloadDigest: string;

    constructor(presentationId: string, reservedSourceRef: Ref, payloadDigest: string) {
        this._presentationId = presentationId
        this._reservedSourceRef = reservedSourceRef
        this._payloadDigest = payloadDigest
    }

    public get presentationId(): string {
        return this._presentationId;
    }
    public get reservedSourceRef(): Ref {
        return this._reservedSourceRef;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            presentationId: this._presentationId,
            reservedSourceRef: this._reservedSourceRef,
            payloadDigest: this._payloadDigest
        };
    }

    public with(overrides: {presentationId?: string; reservedSourceRef?: Ref; payloadDigest?: string}): PresentationPublication {
        return new PresentationPublication(
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'reservedSourceRef' in overrides ? overrides.reservedSourceRef! : this._reservedSourceRef,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest
        );
    }

    public static fromPlain(obj: {presentationId: string; reservedSourceRef: Ref; payloadDigest: string}): PresentationPublication {
        return new PresentationPublication(
            obj.presentationId,
            obj.reservedSourceRef,
            obj.payloadDigest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationPublication.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationPublication.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationPublication'
    public baboonTypeIdentifier() {
        return PresentationPublication.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentationPublication.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentationPublication.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentationPublication.BaboonMinReaderVersions
    }
    public static jsonCodec(): PresentationPublication_JsonCodec {
        return PresentationPublication_JsonCodec.instance
    }
}

export class PresentationPublication_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentationPublication): unknown {
        if (this !== PresentationPublication_JsonCodec.lazyInstance.value) {
          return PresentationPublication_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "presentationId": value.presentationId,
            "reservedSourceRef": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reservedSourceRef),
            "payloadDigest": value.payloadDigest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentationPublication {
        if (this !== PresentationPublication_JsonCodec .lazyInstance.value) {
            return PresentationPublication_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentationPublication (
            obj["presentationId"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reservedSourceRef"]),
            obj["payloadDigest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationPublication_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationPublication_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationPublication'
    public baboonTypeIdentifier() {
        return PresentationPublication_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentationPublication_JsonCodec())
    public static get instance(): PresentationPublication_JsonCodec {
        return PresentationPublication_JsonCodec.lazyInstance.value
    }
}