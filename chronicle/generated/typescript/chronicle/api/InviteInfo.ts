import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class InviteInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _groupId: string;
    private readonly _targetId: string;
    private readonly _expiresAt: string;

    constructor(id: string, groupId: string, targetId: string, expiresAt: string) {
        this._id = id
        this._groupId = groupId
        this._targetId = targetId
        this._expiresAt = expiresAt
    }

    public get id(): string {
        return this._id;
    }
    public get groupId(): string {
        return this._groupId;
    }
    public get targetId(): string {
        return this._targetId;
    }
    public get expiresAt(): string {
        return this._expiresAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            groupId: this._groupId,
            targetId: this._targetId,
            expiresAt: this._expiresAt
        };
    }

    public with(overrides: {id?: string; groupId?: string; targetId?: string; expiresAt?: string}): InviteInfo {
        return new InviteInfo(
            'id' in overrides ? overrides.id! : this._id,
            'groupId' in overrides ? overrides.groupId! : this._groupId,
            'targetId' in overrides ? overrides.targetId! : this._targetId,
            'expiresAt' in overrides ? overrides.expiresAt! : this._expiresAt
        );
    }

    public static fromPlain(obj: {id: string; groupId: string; targetId: string; expiresAt: string}): InviteInfo {
        return new InviteInfo(
            obj.id,
            obj.groupId,
            obj.targetId,
            obj.expiresAt
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return InviteInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return InviteInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#InviteInfo'
    public baboonTypeIdentifier() {
        return InviteInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return InviteInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical" }
    public baboonForwardReadable() {
        return InviteInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return InviteInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): InviteInfo_JsonCodec {
        return InviteInfo_JsonCodec.instance
    }
}

export class InviteInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InviteInfo): unknown {
        if (this !== InviteInfo_JsonCodec.lazyInstance.value) {
          return InviteInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "groupId": value.groupId,
            "targetId": value.targetId,
            "expiresAt": value.expiresAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InviteInfo {
        if (this !== InviteInfo_JsonCodec .lazyInstance.value) {
            return InviteInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new InviteInfo (
            obj["id"] as string,
            obj["groupId"] as string,
            obj["targetId"] as string,
            obj["expiresAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return InviteInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return InviteInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#InviteInfo'
    public baboonTypeIdentifier() {
        return InviteInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InviteInfo_JsonCodec())
    public static get instance(): InviteInfo_JsonCodec {
        return InviteInfo_JsonCodec.lazyInstance.value
    }
}