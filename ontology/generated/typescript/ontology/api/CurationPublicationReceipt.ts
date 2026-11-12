import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CurationPublicationReceipt implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _scope: string;
    private readonly _input: Ref;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _recordedAt: string;

    constructor(attemptId: string, scope: string, input: Ref, generation: bigint, frontier: bigint, coveredFrontier: bigint, recordedAt: string) {
        this._attemptId = attemptId
        this._scope = scope
        this._input = input
        this._generation = generation
        this._frontier = frontier
        this._coveredFrontier = coveredFrontier
        this._recordedAt = recordedAt
    }

    public get attemptId(): string {
        return this._attemptId;
    }
    public get scope(): string {
        return this._scope;
    }
    public get input(): Ref {
        return this._input;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            scope: this._scope,
            input: this._input,
            generation: this._generation,
            frontier: this._frontier,
            coveredFrontier: this._coveredFrontier,
            recordedAt: this._recordedAt
        };
    }

    public with(overrides: {attemptId?: string; scope?: string; input?: Ref; generation?: bigint; frontier?: bigint; coveredFrontier?: bigint; recordedAt?: string}): CurationPublicationReceipt {
        return new CurationPublicationReceipt(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'scope' in overrides ? overrides.scope! : this._scope,
            'input' in overrides ? overrides.input! : this._input,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt
        );
    }

    public static fromPlain(obj: {attemptId: string; scope: string; input: Ref; generation: bigint; frontier: bigint; coveredFrontier: bigint; recordedAt: string}): CurationPublicationReceipt {
        return new CurationPublicationReceipt(
            obj.attemptId,
            obj.scope,
            obj.input,
            obj.generation,
            obj.frontier,
            obj.coveredFrontier,
            obj.recordedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationPublicationReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationPublicationReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationPublicationReceipt'
    public baboonTypeIdentifier() {
        return CurationPublicationReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationPublicationReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationPublicationReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationPublicationReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationPublicationReceipt_JsonCodec {
        return CurationPublicationReceipt_JsonCodec.instance
    }
}

export class CurationPublicationReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationPublicationReceipt): unknown {
        if (this !== CurationPublicationReceipt_JsonCodec.lazyInstance.value) {
          return CurationPublicationReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "scope": value.scope,
            "input": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.input),
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "recordedAt": value.recordedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationPublicationReceipt {
        if (this !== CurationPublicationReceipt_JsonCodec .lazyInstance.value) {
            return CurationPublicationReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationPublicationReceipt (
            obj["attemptId"] as string,
            obj["scope"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["input"]),
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            obj["recordedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationPublicationReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationPublicationReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationPublicationReceipt'
    public baboonTypeIdentifier() {
        return CurationPublicationReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationPublicationReceipt_JsonCodec())
    public static get instance(): CurationPublicationReceipt_JsonCodec {
        return CurationPublicationReceipt_JsonCodec.lazyInstance.value
    }
}