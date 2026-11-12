import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Operation, Operation_JsonCodec} from './Operation.js'

export class CurationProposal implements BaboonGeneratedLatest {
    private readonly _expectedGeneration: bigint;
    private readonly _frontier: bigint;
    private readonly _operations: Array<Operation>;

    constructor(expectedGeneration: bigint, frontier: bigint, operations: Array<Operation>) {
        this._expectedGeneration = expectedGeneration
        this._frontier = frontier
        this._operations = operations
    }

    public get expectedGeneration(): bigint {
        return this._expectedGeneration;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get operations(): Array<Operation> {
        return this._operations;
    }

    public toJSON(): Record<string, unknown> {
        return {
            expectedGeneration: this._expectedGeneration,
            frontier: this._frontier,
            operations: this._operations
        };
    }

    public with(overrides: {expectedGeneration?: bigint; frontier?: bigint; operations?: Array<Operation>}): CurationProposal {
        return new CurationProposal(
            'expectedGeneration' in overrides ? overrides.expectedGeneration! : this._expectedGeneration,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'operations' in overrides ? overrides.operations! : this._operations
        );
    }

    public static fromPlain(obj: {expectedGeneration: bigint; frontier: bigint; operations: Array<Operation>}): CurationProposal {
        return new CurationProposal(
            obj.expectedGeneration,
            obj.frontier,
            obj.operations
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationProposal.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationProposal.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationProposal'
    public baboonTypeIdentifier() {
        return CurationProposal.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationProposal.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationProposal.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationProposal.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationProposal_JsonCodec {
        return CurationProposal_JsonCodec.instance
    }
}

export class CurationProposal_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationProposal): unknown {
        if (this !== CurationProposal_JsonCodec.lazyInstance.value) {
          return CurationProposal_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "expectedGeneration": value.expectedGeneration.toString(),
            "frontier": value.frontier.toString(),
            "operations": Array.from(value.operations).map(item => Operation_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationProposal {
        if (this !== CurationProposal_JsonCodec .lazyInstance.value) {
            return CurationProposal_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationProposal (
            BaboonInt64.read(obj["expectedGeneration"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            (obj["operations"] as unknown[]).map(item => Operation_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationProposal_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationProposal_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationProposal'
    public baboonTypeIdentifier() {
        return CurationProposal_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationProposal_JsonCodec())
    public static get instance(): CurationProposal_JsonCodec {
        return CurationProposal_JsonCodec.lazyInstance.value
    }
}