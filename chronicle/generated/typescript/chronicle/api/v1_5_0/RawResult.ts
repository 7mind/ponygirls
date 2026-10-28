import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {RawFile, RawFile_JsonCodec} from './RawFile.js'

export class RawResult implements BaboonGenerated {
    private readonly _files: Array<RawFile>;
    private readonly _revision: number;

    constructor(files: Array<RawFile>, revision: number) {
        this._files = files
        this._revision = revision
    }

    public get files(): Array<RawFile> {
        return this._files;
    }
    public get revision(): number {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            files: this._files,
            revision: this._revision
        };
    }

    public with(overrides: {files?: Array<RawFile>; revision?: number}): RawResult {
        return new RawResult(
            'files' in overrides ? overrides.files! : this._files,
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {files: Array<RawFile>; revision: number}): RawResult {
        return new RawResult(
            obj.files,
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return RawResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawResult'
    public baboonTypeIdentifier() {
        return RawResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return RawResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return RawResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RawResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RawResult_JsonCodec {
        return RawResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.7.0 */
export class RawResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RawResult): unknown {
        if (this !== RawResult_JsonCodec.lazyInstance.value) {
          return RawResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "files": Array.from(value.files).map(item => RawFile_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "revision": value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RawResult {
        if (this !== RawResult_JsonCodec .lazyInstance.value) {
            return RawResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RawResult (
            (obj["files"] as unknown[]).map(item => RawFile_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return RawResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawResult'
    public baboonTypeIdentifier() {
        return RawResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RawResult_JsonCodec())
    public static get instance(): RawResult_JsonCodec {
        return RawResult_JsonCodec.lazyInstance.value
    }
}