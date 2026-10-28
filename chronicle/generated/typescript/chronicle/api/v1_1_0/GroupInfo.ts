import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class GroupInfo implements BaboonGenerated {
    private readonly _id: string;
    private readonly _name: string;
    private readonly _ownerId: string;
    private readonly _members: Array<string>;

    constructor(id: string, name: string, ownerId: string, members: Array<string>) {
        this._id = id
        this._name = name
        this._ownerId = ownerId
        this._members = members
    }

    public get id(): string {
        return this._id;
    }
    public get name(): string {
        return this._name;
    }
    public get ownerId(): string {
        return this._ownerId;
    }
    public get members(): Array<string> {
        return this._members;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            name: this._name,
            ownerId: this._ownerId,
            members: this._members
        };
    }

    public with(overrides: {id?: string; name?: string; ownerId?: string; members?: Array<string>}): GroupInfo {
        return new GroupInfo(
            'id' in overrides ? overrides.id! : this._id,
            'name' in overrides ? overrides.name! : this._name,
            'ownerId' in overrides ? overrides.ownerId! : this._ownerId,
            'members' in overrides ? overrides.members! : this._members
        );
    }

    public static fromPlain(obj: {id: string; name: string; ownerId: string; members: Array<string>}): GroupInfo {
        return new GroupInfo(
            obj.id,
            obj.name,
            obj.ownerId,
            obj.members
        );
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return GroupInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return GroupInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#GroupInfo'
    public baboonTypeIdentifier() {
        return GroupInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return GroupInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return GroupInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return GroupInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): GroupInfo_JsonCodec {
        return GroupInfo_JsonCodec.instance
    }
}

/** @deprecated Version 1.1.0 is deprecated, you should migrate to 1.7.0 */
export class GroupInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GroupInfo): unknown {
        if (this !== GroupInfo_JsonCodec.lazyInstance.value) {
          return GroupInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "name": value.name,
            "ownerId": value.ownerId,
            "members": Array.from(value.members),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GroupInfo {
        if (this !== GroupInfo_JsonCodec .lazyInstance.value) {
            return GroupInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GroupInfo (
            obj["id"] as string,
            obj["name"] as string,
            obj["ownerId"] as string,
            (obj["members"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return GroupInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return GroupInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#GroupInfo'
    public baboonTypeIdentifier() {
        return GroupInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GroupInfo_JsonCodec())
    public static get instance(): GroupInfo_JsonCodec {
        return GroupInfo_JsonCodec.lazyInstance.value
    }
}