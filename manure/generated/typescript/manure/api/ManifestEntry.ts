import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export type ManifestEntry = ManifestEntry_File | ManifestEntry_Directory

export const ManifestEntry = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ManifestEntry',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'manure.api/:#ManifestEntry',
    jsonCodec(): ManifestEntry_JsonCodec {
        return ManifestEntry_JsonCodec.instance
    }
} as const

export class ManifestEntry_File implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ManifestEntry]#File' as const;
    private readonly _path: string;
    private readonly _size: bigint;
    private readonly _sha256: string;

    constructor(path: string, size: bigint, sha256: string) {
        this._path = path
        this._size = size
        this._sha256 = sha256
    }

    public get path(): string {
        return this._path;
    }
    public get size(): bigint {
        return this._size;
    }
    public get sha256(): string {
        return this._sha256;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            size: this._size,
            sha256: this._sha256
        };
    }

    public with(overrides: {path?: string; size?: bigint; sha256?: string}): ManifestEntry_File {
        return new ManifestEntry_File(
            'path' in overrides ? overrides.path! : this._path,
            'size' in overrides ? overrides.size! : this._size,
            'sha256' in overrides ? overrides.sha256! : this._sha256
        );
    }

    public static fromPlain(obj: {path: string; size: bigint; sha256: string}): ManifestEntry_File {
        return new ManifestEntry_File(
            obj.path,
            obj.size,
            obj.sha256
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ManifestEntry_File.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ManifestEntry_File.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#File'
    public baboonTypeIdentifier() {
        return ManifestEntry_File.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ManifestEntry_File.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ManifestEntry_File.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ManifestEntry_File.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonAdtTypeIdentifier() {
        return ManifestEntry_File.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ManifestEntry_File_JsonCodec {
        return ManifestEntry_File_JsonCodec.instance
    }
}

export class ManifestEntry_File_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ManifestEntry_File): unknown {
        if (this !== ManifestEntry_File_JsonCodec.lazyInstance.value) {
          return ManifestEntry_File_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "size": value.size.toString(),
            "sha256": value.sha256,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ManifestEntry_File {
        if (this !== ManifestEntry_File_JsonCodec .lazyInstance.value) {
            return ManifestEntry_File_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ManifestEntry_File (
            obj["path"] as string,
            BaboonInt64.read(obj["size"], "i64/u64"),
            obj["sha256"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ManifestEntry_File_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#File'
    public baboonTypeIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonAdtTypeIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ManifestEntry_File_JsonCodec())
    public static get instance(): ManifestEntry_File_JsonCodec {
        return ManifestEntry_File_JsonCodec.lazyInstance.value
    }
}

export class ManifestEntry_Directory implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ManifestEntry]#Directory' as const;
    private readonly _path: string;

    constructor(path: string) {
        this._path = path
    }

    public get path(): string {
        return this._path;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path
        };
    }

    public with(overrides: {path?: string}): ManifestEntry_Directory {
        return new ManifestEntry_Directory(
            'path' in overrides ? overrides.path! : this._path
        );
    }

    public static fromPlain(obj: {path: string}): ManifestEntry_Directory {
        return new ManifestEntry_Directory(
            obj.path
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ManifestEntry_Directory.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ManifestEntry_Directory.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#Directory'
    public baboonTypeIdentifier() {
        return ManifestEntry_Directory.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ManifestEntry_Directory.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ManifestEntry_Directory.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ManifestEntry_Directory.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonAdtTypeIdentifier() {
        return ManifestEntry_Directory.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ManifestEntry_Directory_JsonCodec {
        return ManifestEntry_Directory_JsonCodec.instance
    }
}

export class ManifestEntry_Directory_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ManifestEntry_Directory): unknown {
        if (this !== ManifestEntry_Directory_JsonCodec.lazyInstance.value) {
          return ManifestEntry_Directory_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ManifestEntry_Directory {
        if (this !== ManifestEntry_Directory_JsonCodec .lazyInstance.value) {
            return ManifestEntry_Directory_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ManifestEntry_Directory (
            obj["path"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ManifestEntry_Directory_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#Directory'
    public baboonTypeIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonAdtTypeIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ManifestEntry_Directory_JsonCodec())
    public static get instance(): ManifestEntry_Directory_JsonCodec {
        return ManifestEntry_Directory_JsonCodec.lazyInstance.value
    }
}


export class ManifestEntry_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ManifestEntry): unknown {
        if (this !== ManifestEntry_JsonCodec.lazyInstance.value) {
          return ManifestEntry_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ManifestEntry_File) {
                return { "File": ManifestEntry_File_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ManifestEntry_Directory) {
                return { "Directory": ManifestEntry_Directory_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ManifestEntry {
        if (this !== ManifestEntry_JsonCodec .lazyInstance.value) {
            return ManifestEntry_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "File": return ManifestEntry_File_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Directory": return ManifestEntry_Directory_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ManifestEntry_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ManifestEntry_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonTypeIdentifier() {
        return ManifestEntry_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry'
    public baboonAdtTypeIdentifier() {
        return ManifestEntry_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ManifestEntry_JsonCodec())
    public static get instance(): ManifestEntry_JsonCodec {
        return ManifestEntry_JsonCodec.lazyInstance.value
    }
}