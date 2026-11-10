import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {GraphRecord, GraphRecord_JsonCodec} from './GraphRecord.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class Presentation implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _targets: Array<Ref>;
    private readonly _records: Array<GraphRecord>;
    private readonly _sourceRefs: Array<Ref>;
    private readonly _createdAt: string;

    constructor(id: string, scope: string, generation: bigint, targets: Array<Ref>, records: Array<GraphRecord>, sourceRefs: Array<Ref>, createdAt: string) {
        this._id = id
        this._scope = scope
        this._generation = generation
        this._targets = targets
        this._records = records
        this._sourceRefs = sourceRefs
        this._createdAt = createdAt
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get targets(): Array<Ref> {
        return this._targets;
    }
    public get records(): Array<GraphRecord> {
        return this._records;
    }
    public get sourceRefs(): Array<Ref> {
        return this._sourceRefs;
    }
    public get createdAt(): string {
        return this._createdAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            generation: this._generation,
            targets: this._targets,
            records: this._records,
            sourceRefs: this._sourceRefs,
            createdAt: this._createdAt
        };
    }

    public with(overrides: {id?: string; scope?: string; generation?: bigint; targets?: Array<Ref>; records?: Array<GraphRecord>; sourceRefs?: Array<Ref>; createdAt?: string}): Presentation {
        return new Presentation(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'targets' in overrides ? overrides.targets! : this._targets,
            'records' in overrides ? overrides.records! : this._records,
            'sourceRefs' in overrides ? overrides.sourceRefs! : this._sourceRefs,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt
        );
    }

    public static fromPlain(obj: {id: string; scope: string; generation: bigint; targets: Array<Ref>; records: Array<GraphRecord>; sourceRefs: Array<Ref>; createdAt: string}): Presentation {
        return new Presentation(
            obj.id,
            obj.scope,
            obj.generation,
            obj.targets,
            obj.records,
            obj.sourceRefs,
            obj.createdAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Presentation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Presentation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Presentation'
    public baboonTypeIdentifier() {
        return Presentation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Presentation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Presentation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Presentation.BaboonMinReaderVersions
    }
    public static jsonCodec(): Presentation_JsonCodec {
        return Presentation_JsonCodec.instance
    }
}

export class Presentation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Presentation): unknown {
        if (this !== Presentation_JsonCodec.lazyInstance.value) {
          return Presentation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "scope": value.scope,
            "generation": value.generation.toString(),
            "targets": Array.from(value.targets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "records": Array.from(value.records).map(item => GraphRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "sourceRefs": Array.from(value.sourceRefs).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "createdAt": value.createdAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Presentation {
        if (this !== Presentation_JsonCodec .lazyInstance.value) {
            return Presentation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Presentation (
            obj["id"] as string,
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            (obj["targets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["records"] as unknown[]).map(item => GraphRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["sourceRefs"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["createdAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Presentation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Presentation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Presentation'
    public baboonTypeIdentifier() {
        return Presentation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Presentation_JsonCodec())
    public static get instance(): Presentation_JsonCodec {
        return Presentation_JsonCodec.lazyInstance.value
    }
}