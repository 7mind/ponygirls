import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CapsuleChange, CapsuleChange_JsonCodec} from './CapsuleChange.js'
import {CapsuleManifestEntry, CapsuleManifestEntry_JsonCodec} from './CapsuleManifestEntry.js'
import {CapsuleQualification, CapsuleQualification_JsonCodec} from './CapsuleQualification.js'

export class CapsuleManifest implements BaboonGeneratedLatest {
    private readonly _entries: Array<CapsuleManifestEntry>;
    private readonly _changes: Array<CapsuleChange>;
    private readonly _qualifications: Array<CapsuleQualification>;

    constructor(entries: Array<CapsuleManifestEntry>, changes: Array<CapsuleChange>, qualifications: Array<CapsuleQualification>) {
        this._entries = entries
        this._changes = changes
        this._qualifications = qualifications
    }

    public get entries(): Array<CapsuleManifestEntry> {
        return this._entries;
    }
    public get changes(): Array<CapsuleChange> {
        return this._changes;
    }
    public get qualifications(): Array<CapsuleQualification> {
        return this._qualifications;
    }

    public toJSON(): Record<string, unknown> {
        return {
            entries: this._entries,
            changes: this._changes,
            qualifications: this._qualifications
        };
    }

    public with(overrides: {entries?: Array<CapsuleManifestEntry>; changes?: Array<CapsuleChange>; qualifications?: Array<CapsuleQualification>}): CapsuleManifest {
        return new CapsuleManifest(
            'entries' in overrides ? overrides.entries! : this._entries,
            'changes' in overrides ? overrides.changes! : this._changes,
            'qualifications' in overrides ? overrides.qualifications! : this._qualifications
        );
    }

    public static fromPlain(obj: {entries: Array<CapsuleManifestEntry>; changes: Array<CapsuleChange>; qualifications: Array<CapsuleQualification>}): CapsuleManifest {
        return new CapsuleManifest(
            obj.entries,
            obj.changes,
            obj.qualifications
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleManifest'
    public baboonTypeIdentifier() {
        return CapsuleManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleManifest.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleManifest_JsonCodec {
        return CapsuleManifest_JsonCodec.instance
    }
}

export class CapsuleManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleManifest): unknown {
        if (this !== CapsuleManifest_JsonCodec.lazyInstance.value) {
          return CapsuleManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "entries": Array.from(value.entries).map(item => CapsuleManifestEntry_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "changes": Array.from(value.changes).map(item => CapsuleChange_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "qualifications": Array.from(value.qualifications).map(item => CapsuleQualification_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleManifest {
        if (this !== CapsuleManifest_JsonCodec .lazyInstance.value) {
            return CapsuleManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleManifest (
            (obj["entries"] as unknown[]).map(item => CapsuleManifestEntry_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["changes"] as unknown[]).map(item => CapsuleChange_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["qualifications"] as unknown[]).map(item => CapsuleQualification_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleManifest'
    public baboonTypeIdentifier() {
        return CapsuleManifest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleManifest_JsonCodec())
    public static get instance(): CapsuleManifest_JsonCodec {
        return CapsuleManifest_JsonCodec.lazyInstance.value
    }
}