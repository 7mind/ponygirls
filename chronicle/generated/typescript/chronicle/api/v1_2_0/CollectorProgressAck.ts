import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class CollectorProgressAck implements BaboonGenerated {
    private readonly _sequence: bigint;
    private readonly _accepted: boolean;

    constructor(sequence: bigint, accepted: boolean) {
        this._sequence = sequence
        this._accepted = accepted
    }

    public get sequence(): bigint {
        return this._sequence;
    }
    public get accepted(): boolean {
        return this._accepted;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sequence: this._sequence,
            accepted: this._accepted
        };
    }

    public with(overrides: {sequence?: bigint; accepted?: boolean}): CollectorProgressAck {
        return new CollectorProgressAck(
            'sequence' in overrides ? overrides.sequence! : this._sequence,
            'accepted' in overrides ? overrides.accepted! : this._accepted
        );
    }

    public static fromPlain(obj: {sequence: bigint; accepted: boolean}): CollectorProgressAck {
        return new CollectorProgressAck(
            obj.sequence,
            obj.accepted
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return CollectorProgressAck.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorProgressAck.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorProgressAck'
    public baboonTypeIdentifier() {
        return CollectorProgressAck.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return CollectorProgressAck.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return CollectorProgressAck.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return CollectorProgressAck.BaboonMinReaderVersions
    }
    public static jsonCodec(): CollectorProgressAck_JsonCodec {
        return CollectorProgressAck_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.4.0 */
export class CollectorProgressAck_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorProgressAck): unknown {
        if (this !== CollectorProgressAck_JsonCodec.lazyInstance.value) {
          return CollectorProgressAck_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sequence": value.sequence.toString(),
            "accepted": value.accepted,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorProgressAck {
        if (this !== CollectorProgressAck_JsonCodec .lazyInstance.value) {
            return CollectorProgressAck_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CollectorProgressAck (
            BaboonInt64.read(obj["sequence"], "i64/u64"),
            obj["accepted"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return CollectorProgressAck_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorProgressAck_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorProgressAck'
    public baboonTypeIdentifier() {
        return CollectorProgressAck_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorProgressAck_JsonCodec())
    public static get instance(): CollectorProgressAck_JsonCodec {
        return CollectorProgressAck_JsonCodec.lazyInstance.value
    }
}