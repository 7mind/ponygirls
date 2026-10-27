import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {GroupInfo, GroupInfo_JsonCodec} from './GroupInfo.js'
import {InviteInfo, InviteInfo_JsonCodec} from './InviteInfo.js'

export class GroupsResult implements BaboonGenerated {
    private readonly _groups: Array<GroupInfo>;
    private readonly _invitations: Array<InviteInfo>;

    constructor(groups: Array<GroupInfo>, invitations: Array<InviteInfo>) {
        this._groups = groups
        this._invitations = invitations
    }

    public get groups(): Array<GroupInfo> {
        return this._groups;
    }
    public get invitations(): Array<InviteInfo> {
        return this._invitations;
    }

    public toJSON(): Record<string, unknown> {
        return {
            groups: this._groups,
            invitations: this._invitations
        };
    }

    public with(overrides: {groups?: Array<GroupInfo>; invitations?: Array<InviteInfo>}): GroupsResult {
        return new GroupsResult(
            'groups' in overrides ? overrides.groups! : this._groups,
            'invitations' in overrides ? overrides.invitations! : this._invitations
        );
    }

    public static fromPlain(obj: {groups: Array<GroupInfo>; invitations: Array<InviteInfo>}): GroupsResult {
        return new GroupsResult(
            obj.groups,
            obj.invitations
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return GroupsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return GroupsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#GroupsResult'
    public baboonTypeIdentifier() {
        return GroupsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return GroupsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return GroupsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return GroupsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): GroupsResult_JsonCodec {
        return GroupsResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.5.0 */
export class GroupsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GroupsResult): unknown {
        if (this !== GroupsResult_JsonCodec.lazyInstance.value) {
          return GroupsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "groups": Array.from(value.groups).map(item => GroupInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "invitations": Array.from(value.invitations).map(item => InviteInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GroupsResult {
        if (this !== GroupsResult_JsonCodec .lazyInstance.value) {
            return GroupsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GroupsResult (
            (obj["groups"] as unknown[]).map(item => GroupInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["invitations"] as unknown[]).map(item => InviteInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return GroupsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return GroupsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#GroupsResult'
    public baboonTypeIdentifier() {
        return GroupsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GroupsResult_JsonCodec())
    public static get instance(): GroupsResult_JsonCodec {
        return GroupsResult_JsonCodec.lazyInstance.value
    }
}