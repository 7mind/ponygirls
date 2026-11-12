import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {ContextRecord, ContextRecord_JsonCodec} from './ContextRecord.js'
import {InputKind, InputKind_JsonCodec} from './InputKind.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'

export class InputReceipt implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _kind: InputKind;
    private readonly _contributor: Actor;
    private readonly _recorder: Actor;
    private readonly _submitter: Actor;
    private readonly _encoding: string;
    private readonly _content: string;
    private readonly _digest: string;
    private readonly _recordedAt: string;
    private readonly _contributionContext: ContextRecord;
    private readonly _ingress: RequestTrace;

    constructor(ref: Ref, scope: string, generation: bigint, kind: InputKind, contributor: Actor, recorder: Actor, submitter: Actor, encoding: string, content: string, digest: string, recordedAt: string, contributionContext: ContextRecord, ingress: RequestTrace) {
        this._ref = ref
        this._scope = scope
        this._generation = generation
        this._kind = kind
        this._contributor = contributor
        this._recorder = recorder
        this._submitter = submitter
        this._encoding = encoding
        this._content = content
        this._digest = digest
        this._recordedAt = recordedAt
        this._contributionContext = contributionContext
        this._ingress = ingress
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get kind(): InputKind {
        return this._kind;
    }
    public get contributor(): Actor {
        return this._contributor;
    }
    public get recorder(): Actor {
        return this._recorder;
    }
    public get submitter(): Actor {
        return this._submitter;
    }
    public get encoding(): string {
        return this._encoding;
    }
    public get content(): string {
        return this._content;
    }
    public get digest(): string {
        return this._digest;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }
    public get contributionContext(): ContextRecord {
        return this._contributionContext;
    }
    public get ingress(): RequestTrace {
        return this._ingress;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            generation: this._generation,
            kind: this._kind,
            contributor: this._contributor,
            recorder: this._recorder,
            submitter: this._submitter,
            encoding: this._encoding,
            content: this._content,
            digest: this._digest,
            recordedAt: this._recordedAt,
            contributionContext: this._contributionContext,
            ingress: this._ingress
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; generation?: bigint; kind?: InputKind; contributor?: Actor; recorder?: Actor; submitter?: Actor; encoding?: string; content?: string; digest?: string; recordedAt?: string; contributionContext?: ContextRecord; ingress?: RequestTrace}): InputReceipt {
        return new InputReceipt(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'kind' in overrides ? overrides.kind! : this._kind,
            'contributor' in overrides ? overrides.contributor! : this._contributor,
            'recorder' in overrides ? overrides.recorder! : this._recorder,
            'submitter' in overrides ? overrides.submitter! : this._submitter,
            'encoding' in overrides ? overrides.encoding! : this._encoding,
            'content' in overrides ? overrides.content! : this._content,
            'digest' in overrides ? overrides.digest! : this._digest,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt,
            'contributionContext' in overrides ? overrides.contributionContext! : this._contributionContext,
            'ingress' in overrides ? overrides.ingress! : this._ingress
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; generation: bigint; kind: InputKind; contributor: Actor; recorder: Actor; submitter: Actor; encoding: string; content: string; digest: string; recordedAt: string; contributionContext: ContextRecord; ingress: RequestTrace}): InputReceipt {
        return new InputReceipt(
            obj.ref,
            obj.scope,
            obj.generation,
            obj.kind,
            obj.contributor,
            obj.recorder,
            obj.submitter,
            obj.encoding,
            obj.content,
            obj.digest,
            obj.recordedAt,
            obj.contributionContext,
            obj.ingress
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InputReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InputReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#InputReceipt'
    public baboonTypeIdentifier() {
        return InputReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return InputReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return InputReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return InputReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): InputReceipt_JsonCodec {
        return InputReceipt_JsonCodec.instance
    }
}

export class InputReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InputReceipt): unknown {
        if (this !== InputReceipt_JsonCodec.lazyInstance.value) {
          return InputReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "generation": value.generation.toString(),
            "kind": InputKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "contributor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contributor),
            "recorder": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.recorder),
            "submitter": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.submitter),
            "encoding": value.encoding,
            "content": value.content,
            "digest": value.digest,
            "recordedAt": value.recordedAt,
            "contributionContext": ContextRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contributionContext),
            "ingress": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ingress),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InputReceipt {
        if (this !== InputReceipt_JsonCodec .lazyInstance.value) {
            return InputReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new InputReceipt (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            InputKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contributor"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["recorder"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["submitter"]),
            obj["encoding"] as string,
            obj["content"] as string,
            obj["digest"] as string,
            obj["recordedAt"] as string,
            ContextRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contributionContext"]),
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ingress"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InputReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InputReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#InputReceipt'
    public baboonTypeIdentifier() {
        return InputReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InputReceipt_JsonCodec())
    public static get instance(): InputReceipt_JsonCodec {
        return InputReceipt_JsonCodec.lazyInstance.value
    }
}