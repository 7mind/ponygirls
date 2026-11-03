import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {PrincipalType, PrincipalType_JsonCodec} from './PrincipalType.js'

export class Principal implements BaboonGeneratedLatest {
    private readonly _userId: string;
    private readonly _tokenId: string;
    private readonly _principalType: PrincipalType;

    constructor(userId: string, tokenId: string, principalType: PrincipalType) {
        this._userId = userId
        this._tokenId = tokenId
        this._principalType = principalType
    }

    public get userId(): string {
        return this._userId;
    }
    public get tokenId(): string {
        return this._tokenId;
    }
    public get principalType(): PrincipalType {
        return this._principalType;
    }

    public toJSON(): Record<string, unknown> {
        return {
            userId: this._userId,
            tokenId: this._tokenId,
            principalType: this._principalType
        };
    }

    public with(overrides: {userId?: string; tokenId?: string; principalType?: PrincipalType}): Principal {
        return new Principal(
            'userId' in overrides ? overrides.userId! : this._userId,
            'tokenId' in overrides ? overrides.tokenId! : this._tokenId,
            'principalType' in overrides ? overrides.principalType! : this._principalType
        );
    }

    public static fromPlain(obj: {userId: string; tokenId: string; principalType: PrincipalType}): Principal {
        return new Principal(
            obj.userId,
            obj.tokenId,
            obj.principalType
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Principal.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Principal.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Principal'
    public baboonTypeIdentifier() {
        return Principal.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Principal.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Principal.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Principal.BaboonMinReaderVersions
    }
    public static jsonCodec(): Principal_JsonCodec {
        return Principal_JsonCodec.instance
    }
}

export class Principal_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Principal): unknown {
        if (this !== Principal_JsonCodec.lazyInstance.value) {
          return Principal_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "userId": value.userId,
            "tokenId": value.tokenId,
            "principalType": PrincipalType_JsonCodec.instance.encode(BaboonCodecContext.Default, value.principalType),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Principal {
        if (this !== Principal_JsonCodec .lazyInstance.value) {
            return Principal_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Principal (
            obj["userId"] as string,
            obj["tokenId"] as string,
            PrincipalType_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["principalType"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Principal_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Principal_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Principal'
    public baboonTypeIdentifier() {
        return Principal_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Principal_JsonCodec())
    public static get instance(): Principal_JsonCodec {
        return Principal_JsonCodec.lazyInstance.value
    }
}