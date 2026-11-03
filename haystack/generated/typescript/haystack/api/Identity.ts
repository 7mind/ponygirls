import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Identity implements BaboonGeneratedLatest {
    private readonly _userId: string;
    private readonly _userType: string;
    private readonly _tokenId: string;
    private readonly _activityProjectId: string;

    constructor(userId: string, userType: string, tokenId: string, activityProjectId: string) {
        this._userId = userId
        this._userType = userType
        this._tokenId = tokenId
        this._activityProjectId = activityProjectId
    }

    public get userId(): string {
        return this._userId;
    }
    public get userType(): string {
        return this._userType;
    }
    public get tokenId(): string {
        return this._tokenId;
    }
    public get activityProjectId(): string {
        return this._activityProjectId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            userId: this._userId,
            userType: this._userType,
            tokenId: this._tokenId,
            activityProjectId: this._activityProjectId
        };
    }

    public with(overrides: {userId?: string; userType?: string; tokenId?: string; activityProjectId?: string}): Identity {
        return new Identity(
            'userId' in overrides ? overrides.userId! : this._userId,
            'userType' in overrides ? overrides.userType! : this._userType,
            'tokenId' in overrides ? overrides.tokenId! : this._tokenId,
            'activityProjectId' in overrides ? overrides.activityProjectId! : this._activityProjectId
        );
    }

    public static fromPlain(obj: {userId: string; userType: string; tokenId: string; activityProjectId: string}): Identity {
        return new Identity(
            obj.userId,
            obj.userType,
            obj.tokenId,
            obj.activityProjectId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Identity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Identity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Identity'
    public baboonTypeIdentifier() {
        return Identity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Identity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Identity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Identity.BaboonMinReaderVersions
    }
    public static jsonCodec(): Identity_JsonCodec {
        return Identity_JsonCodec.instance
    }
}

export class Identity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Identity): unknown {
        if (this !== Identity_JsonCodec.lazyInstance.value) {
          return Identity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "userId": value.userId,
            "userType": value.userType,
            "tokenId": value.tokenId,
            "activityProjectId": value.activityProjectId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Identity {
        if (this !== Identity_JsonCodec .lazyInstance.value) {
            return Identity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Identity (
            obj["userId"] as string,
            obj["userType"] as string,
            obj["tokenId"] as string,
            obj["activityProjectId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Identity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Identity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Identity'
    public baboonTypeIdentifier() {
        return Identity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Identity_JsonCodec())
    public static get instance(): Identity_JsonCodec {
        return Identity_JsonCodec.lazyInstance.value
    }
}