import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ReviewAction, ReviewAction_JsonCodec} from './ReviewAction.js'

export class JudgmentRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _presentationId: string;
    private readonly _action: ReviewAction;
    private readonly _rationale: string;

    constructor(scope: string, requestId: string, presentationId: string, action: ReviewAction, rationale: string) {
        this._scope = scope
        this._requestId = requestId
        this._presentationId = presentationId
        this._action = action
        this._rationale = rationale
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

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            presentationId: this._presentationId,
            action: this._action,
            rationale: this._rationale
        };
    }

    public with(overrides: {scope?: string; requestId?: string; presentationId?: string; action?: ReviewAction; rationale?: string}): JudgmentRequest {
        return new JudgmentRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'action' in overrides ? overrides.action! : this._action,
            'rationale' in overrides ? overrides.rationale! : this._rationale
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; presentationId: string; action: ReviewAction; rationale: string}): JudgmentRequest {
        return new JudgmentRequest(
            obj.scope,
            obj.requestId,
            obj.presentationId,
            obj.action,
            obj.rationale
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return JudgmentRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return JudgmentRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#JudgmentRequest'
    public baboonTypeIdentifier() {
        return JudgmentRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return JudgmentRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return JudgmentRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return JudgmentRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): JudgmentRequest_JsonCodec {
        return JudgmentRequest_JsonCodec.instance
    }
}

export class JudgmentRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JudgmentRequest): unknown {
        if (this !== JudgmentRequest_JsonCodec.lazyInstance.value) {
          return JudgmentRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "presentationId": value.presentationId,
            "action": ReviewAction_JsonCodec.instance.encode(BaboonCodecContext.Default, value.action),
            "rationale": value.rationale,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JudgmentRequest {
        if (this !== JudgmentRequest_JsonCodec .lazyInstance.value) {
            return JudgmentRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new JudgmentRequest (
            obj["scope"] as string,
            obj["requestId"] as string,
            obj["presentationId"] as string,
            ReviewAction_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["action"]),
            obj["rationale"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return JudgmentRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return JudgmentRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#JudgmentRequest'
    public baboonTypeIdentifier() {
        return JudgmentRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JudgmentRequest_JsonCodec())
    public static get instance(): JudgmentRequest_JsonCodec {
        return JudgmentRequest_JsonCodec.lazyInstance.value
    }
}