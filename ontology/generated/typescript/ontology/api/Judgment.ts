import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {ReviewAction, ReviewAction_JsonCodec} from './ReviewAction.js'

export class Judgment implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _presentationId: string;
    private readonly _action: ReviewAction;
    private readonly _rationale: string;
    private readonly _actor: Actor;
    private readonly _recordedAt: string;
    private readonly _source: Ref;
    private readonly _presentationSource: Ref;
    private readonly _input: Ref;

    constructor(id: string, scope: string, requestId: string, presentationId: string, action: ReviewAction, rationale: string, actor: Actor, recordedAt: string, source: Ref, presentationSource: Ref, input: Ref) {
        this._id = id
        this._scope = scope
        this._requestId = requestId
        this._presentationId = presentationId
        this._action = action
        this._rationale = rationale
        this._actor = actor
        this._recordedAt = recordedAt
        this._source = source
        this._presentationSource = presentationSource
        this._input = input
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get presentationId(): string {
        return this._presentationId;
    }
    public get action(): ReviewAction {
        return this._action;
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
    public get source(): Ref {
        return this._source;
    }
    public get presentationSource(): Ref {
        return this._presentationSource;
    }
    public get input(): Ref {
        return this._input;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            requestId: this._requestId,
            presentationId: this._presentationId,
            action: this._action,
            rationale: this._rationale,
            actor: this._actor,
            recordedAt: this._recordedAt,
            source: this._source,
            presentationSource: this._presentationSource,
            input: this._input
        };
    }

    public with(overrides: {id?: string; scope?: string; requestId?: string; presentationId?: string; action?: ReviewAction; rationale?: string; actor?: Actor; recordedAt?: string; source?: Ref; presentationSource?: Ref; input?: Ref}): Judgment {
        return new Judgment(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'action' in overrides ? overrides.action! : this._action,
            'rationale' in overrides ? overrides.rationale! : this._rationale,
            'actor' in overrides ? overrides.actor! : this._actor,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt,
            'source' in overrides ? overrides.source! : this._source,
            'presentationSource' in overrides ? overrides.presentationSource! : this._presentationSource,
            'input' in overrides ? overrides.input! : this._input
        );
    }

    public static fromPlain(obj: {id: string; scope: string; requestId: string; presentationId: string; action: ReviewAction; rationale: string; actor: Actor; recordedAt: string; source: Ref; presentationSource: Ref; input: Ref}): Judgment {
        return new Judgment(
            obj.id,
            obj.scope,
            obj.requestId,
            obj.presentationId,
            obj.action,
            obj.rationale,
            obj.actor,
            obj.recordedAt,
            obj.source,
            obj.presentationSource,
            obj.input
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
            "requestId": value.requestId,
            "presentationId": value.presentationId,
            "action": ReviewAction_JsonCodec.instance.encode(BaboonCodecContext.Default, value.action),
            "rationale": value.rationale,
            "actor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.actor),
            "recordedAt": value.recordedAt,
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "presentationSource": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.presentationSource),
            "input": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.input),
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
            obj["requestId"] as string,
            obj["presentationId"] as string,
            ReviewAction_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["action"]),
            obj["rationale"] as string,
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["actor"]),
            obj["recordedAt"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["presentationSource"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["input"]),
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