import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {CoordinatorFence, CoordinatorFence_JsonCodec} from './CoordinatorFence.js'
import {ProjectionInstance, ProjectionInstance_JsonCodec} from './ProjectionInstance.js'

export class ProjectionSession implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _fence: CoordinatorFence;
    private readonly _instance: ProjectionInstance;
    private readonly _actor: Actor;
    private readonly _scopes: Array<string>;
    private readonly _batchLimit: number;
    private readonly _openedAt: string;

    constructor(id: string, fence: CoordinatorFence, instance: ProjectionInstance, actor: Actor, scopes: Array<string>, batchLimit: number, openedAt: string) {
        this._id = id
        this._fence = fence
        this._instance = instance
        this._actor = actor
        this._scopes = scopes
        this._batchLimit = batchLimit
        this._openedAt = openedAt
    }

    public get id(): string {
        return this._id;
    }
    public get fence(): CoordinatorFence {
        return this._fence;
    }
    public get instance(): ProjectionInstance {
        return this._instance;
    }
    public get actor(): Actor {
        return this._actor;
    }
    public get scopes(): Array<string> {
        return this._scopes;
    }
    public get batchLimit(): number {
        return this._batchLimit;
    }
    public get openedAt(): string {
        return this._openedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            fence: this._fence,
            instance: this._instance,
            actor: this._actor,
            scopes: this._scopes,
            batchLimit: this._batchLimit,
            openedAt: this._openedAt
        };
    }

    public with(overrides: {id?: string; fence?: CoordinatorFence; instance?: ProjectionInstance; actor?: Actor; scopes?: Array<string>; batchLimit?: number; openedAt?: string}): ProjectionSession {
        return new ProjectionSession(
            'id' in overrides ? overrides.id! : this._id,
            'fence' in overrides ? overrides.fence! : this._fence,
            'instance' in overrides ? overrides.instance! : this._instance,
            'actor' in overrides ? overrides.actor! : this._actor,
            'scopes' in overrides ? overrides.scopes! : this._scopes,
            'batchLimit' in overrides ? overrides.batchLimit! : this._batchLimit,
            'openedAt' in overrides ? overrides.openedAt! : this._openedAt
        );
    }

    public static fromPlain(obj: {id: string; fence: CoordinatorFence; instance: ProjectionInstance; actor: Actor; scopes: Array<string>; batchLimit: number; openedAt: string}): ProjectionSession {
        return new ProjectionSession(
            obj.id,
            obj.fence,
            obj.instance,
            obj.actor,
            obj.scopes,
            obj.batchLimit,
            obj.openedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionSession.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionSession.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionSession'
    public baboonTypeIdentifier() {
        return ProjectionSession.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionSession.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionSession.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionSession.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionSession_JsonCodec {
        return ProjectionSession_JsonCodec.instance
    }
}

export class ProjectionSession_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionSession): unknown {
        if (this !== ProjectionSession_JsonCodec.lazyInstance.value) {
          return ProjectionSession_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "fence": CoordinatorFence_JsonCodec.instance.encode(BaboonCodecContext.Default, value.fence),
            "instance": ProjectionInstance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.instance),
            "actor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.actor),
            "scopes": Array.from(value.scopes),
            "batchLimit": value.batchLimit,
            "openedAt": value.openedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionSession {
        if (this !== ProjectionSession_JsonCodec .lazyInstance.value) {
            return ProjectionSession_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionSession (
            obj["id"] as string,
            CoordinatorFence_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["fence"]),
            ProjectionInstance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["instance"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["actor"]),
            (obj["scopes"] as unknown[]).map(item => item as string),
            obj["batchLimit"] as number,
            obj["openedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionSession_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionSession_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionSession'
    public baboonTypeIdentifier() {
        return ProjectionSession_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionSession_JsonCodec())
    public static get instance(): ProjectionSession_JsonCodec {
        return ProjectionSession_JsonCodec.lazyInstance.value
    }
}