import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {JudgmentKind, JudgmentKind_JsonCodec} from './JudgmentKind.js'

export class Judgment implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _presentationId: string;
    private readonly _kind: JudgmentKind;
    private readonly _rationale: string;
    private readonly _actor: Actor;
    private readonly _recordedAt: string;

    constructor(id: string, scope: string, presentationId: string, kind: JudgmentKind, rationale: string, actor: Actor, recordedAt: string) {
        this._id = id
        this._scope = scope
        this._presentationId = presentationId
        this._kind = kind
        this._rationale = rationale
        this._actor = actor
        this._recordedAt = recordedAt
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get presentationId(): string {
        return this._presentationId;
    }
    public get kind(): JudgmentKind {
        return this._kind;
    }
    public get rationale(): string {
        return this._rationale;
    }
    public get actor(): Actor {
        return this._actor;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            presentationId: this._presentationId,
            kind: this._kind,
            rationale: this._rationale,
            actor: this._actor,
            recordedAt: this._recordedAt
        };
    }

    public with(overrides: {id?: string; scope?: string; presentationId?: string; kind?: JudgmentKind; rationale?: string; actor?: Actor; recordedAt?: string}): Judgment {
        return new Judgment(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'kind' in overrides ? overrides.kind! : this._kind,
            'rationale' in overrides ? overrides.rationale! : this._rationale,
            'actor' in overrides ? overrides.actor! : this._actor,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt
        );
    }

    public static fromPlain(obj: {id: string; scope: string; presentationId: string; kind: JudgmentKind; rationale: string; actor: Actor; recordedAt: string}): Judgment {
        return new Judgment(
            obj.id,
            obj.scope,
            obj.presentationId,
            obj.kind,
            obj.rationale,
            obj.actor,
            obj.recordedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Judgment.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Judgment.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Judgment'
    public baboonTypeIdentifier() {
        return Judgment.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Judgment.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Judgment.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Judgment.BaboonMinReaderVersions
    }
    public static jsonCodec(): Judgment_JsonCodec {
        return Judgment_JsonCodec.instance
    }
}

export class Judgment_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Judgment): unknown {
        if (this !== Judgment_JsonCodec.lazyInstance.value) {
          return Judgment_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "scope": value.scope,
            "presentationId": value.presentationId,
            "kind": JudgmentKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "rationale": value.rationale,
            "actor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.actor),
            "recordedAt": value.recordedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Judgment {
        if (this !== Judgment_JsonCodec .lazyInstance.value) {
            return Judgment_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Judgment (
            obj["id"] as string,
            obj["scope"] as string,
            obj["presentationId"] as string,
            JudgmentKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            obj["rationale"] as string,
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["actor"]),
            obj["recordedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Judgment_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Judgment_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Judgment'
    public baboonTypeIdentifier() {
        return Judgment_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Judgment_JsonCodec())
    public static get instance(): Judgment_JsonCodec {
        return Judgment_JsonCodec.lazyInstance.value
    }
}