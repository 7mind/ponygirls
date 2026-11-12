import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CoordinatorFence, CoordinatorFence_JsonCodec} from './CoordinatorFence.js'

export class CoordinatorLease implements BaboonGeneratedLatest {
    private readonly _fence: CoordinatorFence;
    private readonly _acquiredAt: string;
    private readonly _renewedAt: string;
    private readonly _expiresAt: string;

    constructor(fence: CoordinatorFence, acquiredAt: string, renewedAt: string, expiresAt: string) {
        this._fence = fence
        this._acquiredAt = acquiredAt
        this._renewedAt = renewedAt
        this._expiresAt = expiresAt
    }

    public get fence(): CoordinatorFence {
        return this._fence;
    }
    public get acquiredAt(): string {
        return this._acquiredAt;
    }
    public get renewedAt(): string {
        return this._renewedAt;
    }
    public get expiresAt(): string {
        return this._expiresAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            fence: this._fence,
            acquiredAt: this._acquiredAt,
            renewedAt: this._renewedAt,
            expiresAt: this._expiresAt
        };
    }

    public with(overrides: {fence?: CoordinatorFence; acquiredAt?: string; renewedAt?: string; expiresAt?: string}): CoordinatorLease {
        return new CoordinatorLease(
            'fence' in overrides ? overrides.fence! : this._fence,
            'acquiredAt' in overrides ? overrides.acquiredAt! : this._acquiredAt,
            'renewedAt' in overrides ? overrides.renewedAt! : this._renewedAt,
            'expiresAt' in overrides ? overrides.expiresAt! : this._expiresAt
        );
    }

    public static fromPlain(obj: {fence: CoordinatorFence; acquiredAt: string; renewedAt: string; expiresAt: string}): CoordinatorLease {
        return new CoordinatorLease(
            obj.fence,
            obj.acquiredAt,
            obj.renewedAt,
            obj.expiresAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CoordinatorLease.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CoordinatorLease.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CoordinatorLease'
    public baboonTypeIdentifier() {
        return CoordinatorLease.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CoordinatorLease.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CoordinatorLease.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CoordinatorLease.BaboonMinReaderVersions
    }
    public static jsonCodec(): CoordinatorLease_JsonCodec {
        return CoordinatorLease_JsonCodec.instance
    }
}

export class CoordinatorLease_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CoordinatorLease): unknown {
        if (this !== CoordinatorLease_JsonCodec.lazyInstance.value) {
          return CoordinatorLease_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "fence": CoordinatorFence_JsonCodec.instance.encode(BaboonCodecContext.Default, value.fence),
            "acquiredAt": value.acquiredAt,
            "renewedAt": value.renewedAt,
            "expiresAt": value.expiresAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CoordinatorLease {
        if (this !== CoordinatorLease_JsonCodec .lazyInstance.value) {
            return CoordinatorLease_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CoordinatorLease (
            CoordinatorFence_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["fence"]),
            obj["acquiredAt"] as string,
            obj["renewedAt"] as string,
            obj["expiresAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CoordinatorLease_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CoordinatorLease_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CoordinatorLease'
    public baboonTypeIdentifier() {
        return CoordinatorLease_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CoordinatorLease_JsonCodec())
    public static get instance(): CoordinatorLease_JsonCodec {
        return CoordinatorLease_JsonCodec.lazyInstance.value
    }
}