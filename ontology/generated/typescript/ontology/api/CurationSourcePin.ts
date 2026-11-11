import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CurationSourcePin implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _frontier: bigint;
    private readonly _digest: string;

    constructor(ref: Ref, frontier: bigint, digest: string) {
        this._ref = ref
        this._frontier = frontier
        this._digest = digest
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get digest(): string {
        return this._digest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            frontier: this._frontier,
            digest: this._digest
        };
    }

    public with(overrides: {ref?: Ref; frontier?: bigint; digest?: string}): CurationSourcePin {
        return new CurationSourcePin(
            'ref' in overrides ? overrides.ref! : this._ref,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'digest' in overrides ? overrides.digest! : this._digest
        );
    }

    public static fromPlain(obj: {ref: Ref; frontier: bigint; digest: string}): CurationSourcePin {
        return new CurationSourcePin(
            obj.ref,
            obj.frontier,
            obj.digest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationSourcePin.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationSourcePin.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationSourcePin'
    public baboonTypeIdentifier() {
        return CurationSourcePin.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationSourcePin.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationSourcePin.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationSourcePin.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationSourcePin_JsonCodec {
        return CurationSourcePin_JsonCodec.instance
    }
}

export class CurationSourcePin_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationSourcePin): unknown {
        if (this !== CurationSourcePin_JsonCodec.lazyInstance.value) {
          return CurationSourcePin_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "frontier": value.frontier.toString(),
            "digest": value.digest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationSourcePin {
        if (this !== CurationSourcePin_JsonCodec .lazyInstance.value) {
            return CurationSourcePin_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationSourcePin (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            obj["digest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationSourcePin_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationSourcePin_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationSourcePin'
    public baboonTypeIdentifier() {
        return CurationSourcePin_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationSourcePin_JsonCodec())
    public static get instance(): CurationSourcePin_JsonCodec {
        return CurationSourcePin_JsonCodec.lazyInstance.value
    }
}