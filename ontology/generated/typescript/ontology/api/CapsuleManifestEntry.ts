import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CapsulePartition, CapsulePartition_JsonCodec} from './CapsulePartition.js'
import {CapsuleRole, CapsuleRole_JsonCodec} from './CapsuleRole.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CapsuleManifestEntry implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _partition: CapsulePartition;
    private readonly _roles: Array<CapsuleRole>;
    private readonly _evidence: Array<Ref>;

    constructor(ref: Ref, partition: CapsulePartition, roles: Array<CapsuleRole>, evidence: Array<Ref>) {
        this._ref = ref
        this._partition = partition
        this._roles = roles
        this._evidence = evidence
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get partition(): CapsulePartition {
        return this._partition;
    }
    public get roles(): Array<CapsuleRole> {
        return this._roles;
    }
    public get evidence(): Array<Ref> {
        return this._evidence;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            partition: this._partition,
            roles: this._roles,
            evidence: this._evidence
        };
    }

    public with(overrides: {ref?: Ref; partition?: CapsulePartition; roles?: Array<CapsuleRole>; evidence?: Array<Ref>}): CapsuleManifestEntry {
        return new CapsuleManifestEntry(
            'ref' in overrides ? overrides.ref! : this._ref,
            'partition' in overrides ? overrides.partition! : this._partition,
            'roles' in overrides ? overrides.roles! : this._roles,
            'evidence' in overrides ? overrides.evidence! : this._evidence
        );
    }

    public static fromPlain(obj: {ref: Ref; partition: CapsulePartition; roles: Array<CapsuleRole>; evidence: Array<Ref>}): CapsuleManifestEntry {
        return new CapsuleManifestEntry(
            obj.ref,
            obj.partition,
            obj.roles,
            obj.evidence
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleManifestEntry.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleManifestEntry.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleManifestEntry'
    public baboonTypeIdentifier() {
        return CapsuleManifestEntry.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleManifestEntry.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleManifestEntry.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleManifestEntry.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleManifestEntry_JsonCodec {
        return CapsuleManifestEntry_JsonCodec.instance
    }
}

export class CapsuleManifestEntry_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleManifestEntry): unknown {
        if (this !== CapsuleManifestEntry_JsonCodec.lazyInstance.value) {
          return CapsuleManifestEntry_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "partition": CapsulePartition_JsonCodec.instance.encode(BaboonCodecContext.Default, value.partition),
            "roles": Array.from(value.roles).map(item => CapsuleRole_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "evidence": Array.from(value.evidence).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleManifestEntry {
        if (this !== CapsuleManifestEntry_JsonCodec .lazyInstance.value) {
            return CapsuleManifestEntry_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleManifestEntry (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            CapsulePartition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["partition"]),
            (obj["roles"] as unknown[]).map(item => CapsuleRole_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["evidence"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleManifestEntry_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleManifestEntry_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleManifestEntry'
    public baboonTypeIdentifier() {
        return CapsuleManifestEntry_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleManifestEntry_JsonCodec())
    public static get instance(): CapsuleManifestEntry_JsonCodec {
        return CapsuleManifestEntry_JsonCodec.lazyInstance.value
    }
}