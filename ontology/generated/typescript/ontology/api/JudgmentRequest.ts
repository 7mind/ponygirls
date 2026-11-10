import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {JudgmentKind, JudgmentKind_JsonCodec} from './JudgmentKind.js'

export class JudgmentRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _presentationId: string;
    private readonly _kind: JudgmentKind;
    private readonly _rationale: string;

    constructor(scope: string, requestId: string, presentationId: string, kind: JudgmentKind, rationale: string) {
        this._scope = scope
        this._requestId = requestId
        this._presentationId = presentationId
        this._kind = kind
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
    public get kind(): JudgmentKind {
        return this._kind;
    }
    public get rationale(): string {
        return this._rationale;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            presentationId: this._presentationId,
            kind: this._kind,
            rationale: this._rationale
        };
    }

    public with(overrides: {scope?: string; requestId?: string; presentationId?: string; kind?: JudgmentKind; rationale?: string}): JudgmentRequest {
        return new JudgmentRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'kind' in overrides ? overrides.kind! : this._kind,
            'rationale' in overrides ? overrides.rationale! : this._rationale
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; presentationId: string; kind: JudgmentKind; rationale: string}): JudgmentRequest {
        return new JudgmentRequest(
            obj.scope,
            obj.requestId,
            obj.presentationId,
            obj.kind,
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
            "kind": JudgmentKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
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
            JudgmentKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
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