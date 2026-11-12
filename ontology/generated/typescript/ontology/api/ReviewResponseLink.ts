import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class ReviewResponseLink implements BaboonGeneratedLatest {
    private readonly _presentationId: string;
    private readonly _judgmentId: string;
    private readonly _presentationSource: Ref;
    private readonly _payloadDigest: string;

    constructor(presentationId: string, judgmentId: string, presentationSource: Ref, payloadDigest: string) {
        this._presentationId = presentationId
        this._judgmentId = judgmentId
        this._presentationSource = presentationSource
        this._payloadDigest = payloadDigest
    }

    public get presentationId(): string {
        return this._presentationId;
    }
    public get judgmentId(): string {
        return this._judgmentId;
    }
    public get presentationSource(): Ref {
        return this._presentationSource;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            presentationId: this._presentationId,
            judgmentId: this._judgmentId,
            presentationSource: this._presentationSource,
            payloadDigest: this._payloadDigest
        };
    }

    public with(overrides: {presentationId?: string; judgmentId?: string; presentationSource?: Ref; payloadDigest?: string}): ReviewResponseLink {
        return new ReviewResponseLink(
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'judgmentId' in overrides ? overrides.judgmentId! : this._judgmentId,
            'presentationSource' in overrides ? overrides.presentationSource! : this._presentationSource,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest
        );
    }

    public static fromPlain(obj: {presentationId: string; judgmentId: string; presentationSource: Ref; payloadDigest: string}): ReviewResponseLink {
        return new ReviewResponseLink(
            obj.presentationId,
            obj.judgmentId,
            obj.presentationSource,
            obj.payloadDigest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewResponseLink.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewResponseLink.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReviewResponseLink'
    public baboonTypeIdentifier() {
        return ReviewResponseLink.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReviewResponseLink.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReviewResponseLink.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReviewResponseLink.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReviewResponseLink_JsonCodec {
        return ReviewResponseLink_JsonCodec.instance
    }
}

export class ReviewResponseLink_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReviewResponseLink): unknown {
        if (this !== ReviewResponseLink_JsonCodec.lazyInstance.value) {
          return ReviewResponseLink_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "presentationId": value.presentationId,
            "judgmentId": value.judgmentId,
            "presentationSource": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.presentationSource),
            "payloadDigest": value.payloadDigest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReviewResponseLink {
        if (this !== ReviewResponseLink_JsonCodec .lazyInstance.value) {
            return ReviewResponseLink_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReviewResponseLink (
            obj["presentationId"] as string,
            obj["judgmentId"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["presentationSource"]),
            obj["payloadDigest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewResponseLink_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewResponseLink_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReviewResponseLink'
    public baboonTypeIdentifier() {
        return ReviewResponseLink_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReviewResponseLink_JsonCodec())
    public static get instance(): ReviewResponseLink_JsonCodec {
        return ReviewResponseLink_JsonCodec.lazyInstance.value
    }
}