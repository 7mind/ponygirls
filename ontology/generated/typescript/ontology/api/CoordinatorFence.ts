import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class CoordinatorFence implements BaboonGeneratedLatest {
    private readonly _ownerId: string;
    private readonly _epoch: bigint;

    constructor(ownerId: string, epoch: bigint) {
        this._ownerId = ownerId
        this._epoch = epoch
    }

    public get ownerId(): string {
        return this._ownerId;
    }
    public get epoch(): bigint {
        return this._epoch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ownerId: this._ownerId,
            epoch: this._epoch
        };
    }

    public with(overrides: {ownerId?: string; epoch?: bigint}): CoordinatorFence {
        return new CoordinatorFence(
            'ownerId' in overrides ? overrides.ownerId! : this._ownerId,
            'epoch' in overrides ? overrides.epoch! : this._epoch
        );
    }

    public static fromPlain(obj: {ownerId: string; epoch: bigint}): CoordinatorFence {
        return new CoordinatorFence(
            obj.ownerId,
            obj.epoch
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CoordinatorFence.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CoordinatorFence.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CoordinatorFence'
    public baboonTypeIdentifier() {
        return CoordinatorFence.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CoordinatorFence.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CoordinatorFence.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CoordinatorFence.BaboonMinReaderVersions
    }
    public static jsonCodec(): CoordinatorFence_JsonCodec {
        return CoordinatorFence_JsonCodec.instance
    }
}

export class CoordinatorFence_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CoordinatorFence): unknown {
        if (this !== CoordinatorFence_JsonCodec.lazyInstance.value) {
          return CoordinatorFence_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ownerId": value.ownerId,
            "epoch": value.epoch.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CoordinatorFence {
        if (this !== CoordinatorFence_JsonCodec .lazyInstance.value) {
            return CoordinatorFence_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CoordinatorFence (
            obj["ownerId"] as string,
            BaboonInt64.read(obj["epoch"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CoordinatorFence_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CoordinatorFence_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CoordinatorFence'
    public baboonTypeIdentifier() {
        return CoordinatorFence_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CoordinatorFence_JsonCodec())
    public static get instance(): CoordinatorFence_JsonCodec {
        return CoordinatorFence_JsonCodec.lazyInstance.value
    }
}