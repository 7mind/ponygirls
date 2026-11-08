import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {GrantRole, GrantRole_JsonCodec} from './GrantRole.js'

export class SetGrantRequest implements BaboonGeneratedLatest {
    private readonly _repositoryId: string;
    private readonly _userId: string;
    private readonly _role: GrantRole | undefined;
    private readonly _expectedRevision: number;

    constructor(repositoryId: string, userId: string, role: GrantRole | undefined, expectedRevision: number) {
        this._repositoryId = repositoryId
        this._userId = userId
        this._role = role
        this._expectedRevision = expectedRevision
    }

    public get repositoryId(): string {
        return this._repositoryId;
    }
    public get userId(): string {
        return this._userId;
    }
    public get role(): GrantRole | undefined {
        return this._role;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            repositoryId: this._repositoryId,
            userId: this._userId,
            role: this._role !== undefined ? this._role : undefined,
            expectedRevision: this._expectedRevision
        };
    }

    public with(overrides: {repositoryId?: string; userId?: string; role?: GrantRole | undefined; expectedRevision?: number}): SetGrantRequest {
        return new SetGrantRequest(
            'repositoryId' in overrides ? overrides.repositoryId! : this._repositoryId,
            'userId' in overrides ? overrides.userId! : this._userId,
            'role' in overrides ? overrides.role! : this._role,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {repositoryId: string; userId: string; role: GrantRole | undefined; expectedRevision: number}): SetGrantRequest {
        return new SetGrantRequest(
            obj.repositoryId,
            obj.userId,
            obj.role,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return SetGrantRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SetGrantRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SetGrantRequest'
    public baboonTypeIdentifier() {
        return SetGrantRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return SetGrantRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return SetGrantRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return SetGrantRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): SetGrantRequest_JsonCodec {
        return SetGrantRequest_JsonCodec.instance
    }
}

export class SetGrantRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SetGrantRequest): unknown {
        if (this !== SetGrantRequest_JsonCodec.lazyInstance.value) {
          return SetGrantRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "repositoryId": value.repositoryId,
            "userId": value.userId,
            "role": value.role === undefined ? null : GrantRole_JsonCodec.instance.encode(BaboonCodecContext.Default, value.role),
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SetGrantRequest {
        if (this !== SetGrantRequest_JsonCodec .lazyInstance.value) {
            return SetGrantRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SetGrantRequest (
            obj["repositoryId"] as string,
            obj["userId"] as string,
            obj["role"] === undefined || obj["role"] === null ? undefined : obj["role"] === undefined || obj["role"] === null ? undefined : GrantRole_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["role"]),
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return SetGrantRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SetGrantRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SetGrantRequest'
    public baboonTypeIdentifier() {
        return SetGrantRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SetGrantRequest_JsonCodec())
    public static get instance(): SetGrantRequest_JsonCodec {
        return SetGrantRequest_JsonCodec.lazyInstance.value
    }
}