import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RepositoryInfo, RepositoryInfo_JsonCodec} from './RepositoryInfo.js'

export class RepositoryResult implements BaboonGeneratedLatest {
    private readonly _repository: RepositoryInfo;

    constructor(repository: RepositoryInfo) {
        this._repository = repository
    }

    public get repository(): RepositoryInfo {
        return this._repository;
    }

    public toJSON(): Record<string, unknown> {
        return {
            repository: this._repository
        };
    }

    public with(overrides: {repository?: RepositoryInfo}): RepositoryResult {
        return new RepositoryResult(
            'repository' in overrides ? overrides.repository! : this._repository
        );
    }

    public static fromPlain(obj: {repository: RepositoryInfo}): RepositoryResult {
        return new RepositoryResult(
            obj.repository
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RepositoryResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoryResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoryResult'
    public baboonTypeIdentifier() {
        return RepositoryResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return RepositoryResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return RepositoryResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return RepositoryResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RepositoryResult_JsonCodec {
        return RepositoryResult_JsonCodec.instance
    }
}

export class RepositoryResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RepositoryResult): unknown {
        if (this !== RepositoryResult_JsonCodec.lazyInstance.value) {
          return RepositoryResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "repository": RepositoryInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.repository),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RepositoryResult {
        if (this !== RepositoryResult_JsonCodec .lazyInstance.value) {
            return RepositoryResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RepositoryResult (
            RepositoryInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["repository"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RepositoryResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoryResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoryResult'
    public baboonTypeIdentifier() {
        return RepositoryResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RepositoryResult_JsonCodec())
    public static get instance(): RepositoryResult_JsonCodec {
        return RepositoryResult_JsonCodec.lazyInstance.value
    }
}