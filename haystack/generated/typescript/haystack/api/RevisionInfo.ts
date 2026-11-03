import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class RevisionInfo implements BaboonGeneratedLatest {
    private readonly _revision: number;
    private readonly _modifiedAt: string;
    private readonly _modifiedBy: string;
    private readonly _tokenId: string;

    constructor(revision: number, modifiedAt: string, modifiedBy: string, tokenId: string) {
        this._revision = revision
        this._modifiedAt = modifiedAt
        this._modifiedBy = modifiedBy
        this._tokenId = tokenId
    }

    public get revision(): number {
        return this._revision;
    }
    public get modifiedAt(): string {
        return this._modifiedAt;
    }
    public get modifiedBy(): string {
        return this._modifiedBy;
    }
    public get tokenId(): string {
        return this._tokenId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            revision: this._revision,
            modifiedAt: this._modifiedAt,
            modifiedBy: this._modifiedBy,
            tokenId: this._tokenId
        };
    }

    public with(overrides: {revision?: number; modifiedAt?: string; modifiedBy?: string; tokenId?: string}): RevisionInfo {
        return new RevisionInfo(
            'revision' in overrides ? overrides.revision! : this._revision,
            'modifiedAt' in overrides ? overrides.modifiedAt! : this._modifiedAt,
            'modifiedBy' in overrides ? overrides.modifiedBy! : this._modifiedBy,
            'tokenId' in overrides ? overrides.tokenId! : this._tokenId
        );
    }

    public static fromPlain(obj: {revision: number; modifiedAt: string; modifiedBy: string; tokenId: string}): RevisionInfo {
        return new RevisionInfo(
            obj.revision,
            obj.modifiedAt,
            obj.modifiedBy,
            obj.tokenId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RevisionInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RevisionInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RevisionInfo'
    public baboonTypeIdentifier() {
        return RevisionInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return RevisionInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return RevisionInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RevisionInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): RevisionInfo_JsonCodec {
        return RevisionInfo_JsonCodec.instance
    }
}

export class RevisionInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RevisionInfo): unknown {
        if (this !== RevisionInfo_JsonCodec.lazyInstance.value) {
          return RevisionInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "revision": value.revision,
            "modifiedAt": value.modifiedAt,
            "modifiedBy": value.modifiedBy,
            "tokenId": value.tokenId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RevisionInfo {
        if (this !== RevisionInfo_JsonCodec .lazyInstance.value) {
            return RevisionInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RevisionInfo (
            obj["revision"] as number,
            obj["modifiedAt"] as string,
            obj["modifiedBy"] as string,
            obj["tokenId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RevisionInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RevisionInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RevisionInfo'
    public baboonTypeIdentifier() {
        return RevisionInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RevisionInfo_JsonCodec())
    public static get instance(): RevisionInfo_JsonCodec {
        return RevisionInfo_JsonCodec.lazyInstance.value
    }
}