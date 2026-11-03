import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Artifact, Artifact_JsonCodec} from './Artifact.js'

export class CataloguePage implements BaboonGeneratedLatest {
    private readonly _artifacts: Array<Artifact>;
    private readonly _nextCursor: string | undefined;

    constructor(artifacts: Array<Artifact>, nextCursor: string | undefined) {
        this._artifacts = artifacts
        this._nextCursor = nextCursor
    }

    public get artifacts(): Array<Artifact> {
        return this._artifacts;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifacts: this._artifacts,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }

    public with(overrides: {artifacts?: Array<Artifact>; nextCursor?: string | undefined}): CataloguePage {
        return new CataloguePage(
            'artifacts' in overrides ? overrides.artifacts! : this._artifacts,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor
        );
    }

    public static fromPlain(obj: {artifacts: Array<Artifact>; nextCursor: string | undefined}): CataloguePage {
        return new CataloguePage(
            obj.artifacts,
            obj.nextCursor
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CataloguePage.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return CataloguePage.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#CataloguePage'
    public baboonTypeIdentifier() {
        return CataloguePage.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return CataloguePage.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return CataloguePage.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return CataloguePage.BaboonMinReaderVersions
    }
    public static jsonCodec(): CataloguePage_JsonCodec {
        return CataloguePage_JsonCodec.instance
    }
}

export class CataloguePage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CataloguePage): unknown {
        if (this !== CataloguePage_JsonCodec.lazyInstance.value) {
          return CataloguePage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifacts": Array.from(value.artifacts).map(item => Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CataloguePage {
        if (this !== CataloguePage_JsonCodec .lazyInstance.value) {
            return CataloguePage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CataloguePage (
            (obj["artifacts"] as unknown[]).map(item => Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CataloguePage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return CataloguePage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#CataloguePage'
    public baboonTypeIdentifier() {
        return CataloguePage_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CataloguePage_JsonCodec())
    public static get instance(): CataloguePage_JsonCodec {
        return CataloguePage_JsonCodec.lazyInstance.value
    }
}