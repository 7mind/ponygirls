import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {GraphRecord, GraphRecord_JsonCodec} from './GraphRecord.js'
import {PresentationManifest, PresentationManifest_JsonCodec} from './PresentationManifest.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class PresentationPayload implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _targets: Array<Ref>;
    private readonly _records: Array<GraphRecord>;
    private readonly _sourceRefs: Array<Ref>;
    private readonly _manifest: PresentationManifest;

    constructor(scope: string, generation: bigint, targets: Array<Ref>, records: Array<GraphRecord>, sourceRefs: Array<Ref>, manifest: PresentationManifest) {
        this._scope = scope
        this._generation = generation
        this._targets = targets
        this._records = records
        this._sourceRefs = sourceRefs
        this._manifest = manifest
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
    public get manifest(): PresentationManifest {
        return this._manifest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            targets: this._targets,
            records: this._records,
            sourceRefs: this._sourceRefs,
            manifest: this._manifest
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; targets?: Array<Ref>; records?: Array<GraphRecord>; sourceRefs?: Array<Ref>; manifest?: PresentationManifest}): PresentationPayload {
        return new PresentationPayload(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'targets' in overrides ? overrides.targets! : this._targets,
            'records' in overrides ? overrides.records! : this._records,
            'sourceRefs' in overrides ? overrides.sourceRefs! : this._sourceRefs,
            'manifest' in overrides ? overrides.manifest! : this._manifest
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; targets: Array<Ref>; records: Array<GraphRecord>; sourceRefs: Array<Ref>; manifest: PresentationManifest}): PresentationPayload {
        return new PresentationPayload(
            obj.scope,
            obj.generation,
            obj.targets,
            obj.records,
            obj.sourceRefs,
            obj.manifest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationPayload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationPayload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationPayload'
    public baboonTypeIdentifier() {
        return PresentationPayload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentationPayload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentationPayload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentationPayload.BaboonMinReaderVersions
    }
    public static jsonCodec(): PresentationPayload_JsonCodec {
        return PresentationPayload_JsonCodec.instance
    }
}

export class PresentationPayload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentationPayload): unknown {
        if (this !== PresentationPayload_JsonCodec.lazyInstance.value) {
          return PresentationPayload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "targets": Array.from(value.targets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "records": Array.from(value.records).map(item => GraphRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "sourceRefs": Array.from(value.sourceRefs).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "manifest": PresentationManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.manifest),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentationPayload {
        if (this !== PresentationPayload_JsonCodec .lazyInstance.value) {
            return PresentationPayload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentationPayload (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            (obj["targets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["records"] as unknown[]).map(item => GraphRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["sourceRefs"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            PresentationManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["manifest"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationPayload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationPayload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationPayload'
    public baboonTypeIdentifier() {
        return PresentationPayload_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentationPayload_JsonCodec())
    public static get instance(): PresentationPayload_JsonCodec {
        return PresentationPayload_JsonCodec.lazyInstance.value
    }
}