import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {AliasRef, AliasRef_JsonCodec} from './AliasRef.js'

export class ApplyResult implements BaboonGeneratedLatest {
    private readonly _generation: bigint;
    private readonly _created: Array<AliasRef>;
    private readonly _replayed: boolean;

    constructor(generation: bigint, created: Array<AliasRef>, replayed: boolean) {
        this._generation = generation
        this._created = created
        this._replayed = replayed
    }

    public get generation(): bigint {
        return this._generation;
    }
    public get created(): Array<AliasRef> {
        return this._created;
    }
    public get replayed(): boolean {
        return this._replayed;
    }

    public toJSON(): Record<string, unknown> {
        return {
            generation: this._generation,
            created: this._created,
            replayed: this._replayed
        };
    }

    public with(overrides: {generation?: bigint; created?: Array<AliasRef>; replayed?: boolean}): ApplyResult {
        return new ApplyResult(
            'generation' in overrides ? overrides.generation! : this._generation,
            'created' in overrides ? overrides.created! : this._created,
            'replayed' in overrides ? overrides.replayed! : this._replayed
        );
    }

    public static fromPlain(obj: {generation: bigint; created: Array<AliasRef>; replayed: boolean}): ApplyResult {
        return new ApplyResult(
            obj.generation,
            obj.created,
            obj.replayed
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplyResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplyResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplyResult'
    public baboonTypeIdentifier() {
        return ApplyResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplyResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplyResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplyResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ApplyResult_JsonCodec {
        return ApplyResult_JsonCodec.instance
    }
}

export class ApplyResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplyResult): unknown {
        if (this !== ApplyResult_JsonCodec.lazyInstance.value) {
          return ApplyResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "generation": value.generation.toString(),
            "created": Array.from(value.created).map(item => AliasRef_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "replayed": value.replayed,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplyResult {
        if (this !== ApplyResult_JsonCodec .lazyInstance.value) {
            return ApplyResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplyResult (
            BaboonInt64.read(obj["generation"], "i64/u64"),
            (obj["created"] as unknown[]).map(item => AliasRef_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["replayed"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplyResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplyResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplyResult'
    public baboonTypeIdentifier() {
        return ApplyResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplyResult_JsonCodec())
    public static get instance(): ApplyResult_JsonCodec {
        return ApplyResult_JsonCodec.lazyInstance.value
    }
}