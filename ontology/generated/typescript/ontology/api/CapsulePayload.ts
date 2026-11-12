import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CapsuleCut, CapsuleCut_JsonCodec} from './CapsuleCut.js'
import {CapsuleManifest, CapsuleManifest_JsonCodec} from './CapsuleManifest.js'
import {CapsulePolicyIdentity, CapsulePolicyIdentity_JsonCodec} from './CapsulePolicyIdentity.js'
import {ContextRecord, ContextRecord_JsonCodec} from './ContextRecord.js'
import {GraphRecord, GraphRecord_JsonCodec} from './GraphRecord.js'

export class CapsulePayload implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _workContext: string;
    private readonly _reportedContext: ContextRecord;
    private readonly _cut: CapsuleCut;
    private readonly _previousCapsuleId: string | undefined;
    private readonly _policy: CapsulePolicyIdentity;
    private readonly _records: Array<GraphRecord>;
    private readonly _manifest: CapsuleManifest;
    private readonly _text: string;

    constructor(scope: string, workContext: string, reportedContext: ContextRecord, cut: CapsuleCut, previousCapsuleId: string | undefined, policy: CapsulePolicyIdentity, records: Array<GraphRecord>, manifest: CapsuleManifest, text: string) {
        this._scope = scope
        this._workContext = workContext
        this._reportedContext = reportedContext
        this._cut = cut
        this._previousCapsuleId = previousCapsuleId
        this._policy = policy
        this._records = records
        this._manifest = manifest
        this._text = text
    }

    public get scope(): string {
        return this._scope;
    }
    public get workContext(): string {
        return this._workContext;
    }
    public get reportedContext(): ContextRecord {
        return this._reportedContext;
    }
    public get cut(): CapsuleCut {
        return this._cut;
    }
    public get previousCapsuleId(): string | undefined {
        return this._previousCapsuleId;
    }
    public get policy(): CapsulePolicyIdentity {
        return this._policy;
    }
    public get records(): Array<GraphRecord> {
        return this._records;
    }
    public get manifest(): CapsuleManifest {
        return this._manifest;
    }
    public get text(): string {
        return this._text;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            workContext: this._workContext,
            reportedContext: this._reportedContext,
            cut: this._cut,
            previousCapsuleId: this._previousCapsuleId !== undefined ? this._previousCapsuleId : undefined,
            policy: this._policy,
            records: this._records,
            manifest: this._manifest,
            text: this._text
        };
    }

    public with(overrides: {scope?: string; workContext?: string; reportedContext?: ContextRecord; cut?: CapsuleCut; previousCapsuleId?: string | undefined; policy?: CapsulePolicyIdentity; records?: Array<GraphRecord>; manifest?: CapsuleManifest; text?: string}): CapsulePayload {
        return new CapsulePayload(
            'scope' in overrides ? overrides.scope! : this._scope,
            'workContext' in overrides ? overrides.workContext! : this._workContext,
            'reportedContext' in overrides ? overrides.reportedContext! : this._reportedContext,
            'cut' in overrides ? overrides.cut! : this._cut,
            'previousCapsuleId' in overrides ? overrides.previousCapsuleId! : this._previousCapsuleId,
            'policy' in overrides ? overrides.policy! : this._policy,
            'records' in overrides ? overrides.records! : this._records,
            'manifest' in overrides ? overrides.manifest! : this._manifest,
            'text' in overrides ? overrides.text! : this._text
        );
    }

    public static fromPlain(obj: {scope: string; workContext: string; reportedContext: ContextRecord; cut: CapsuleCut; previousCapsuleId: string | undefined; policy: CapsulePolicyIdentity; records: Array<GraphRecord>; manifest: CapsuleManifest; text: string}): CapsulePayload {
        return new CapsulePayload(
            obj.scope,
            obj.workContext,
            obj.reportedContext,
            obj.cut,
            obj.previousCapsuleId,
            obj.policy,
            obj.records,
            obj.manifest,
            obj.text
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsulePayload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsulePayload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsulePayload'
    public baboonTypeIdentifier() {
        return CapsulePayload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsulePayload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsulePayload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsulePayload.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsulePayload_JsonCodec {
        return CapsulePayload_JsonCodec.instance
    }
}

export class CapsulePayload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsulePayload): unknown {
        if (this !== CapsulePayload_JsonCodec.lazyInstance.value) {
          return CapsulePayload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "workContext": value.workContext,
            "reportedContext": ContextRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedContext),
            "cut": CapsuleCut_JsonCodec.instance.encode(BaboonCodecContext.Default, value.cut),
            "previousCapsuleId": value.previousCapsuleId === undefined ? null : value.previousCapsuleId,
            "policy": CapsulePolicyIdentity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.policy),
            "records": Array.from(value.records).map(item => GraphRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "manifest": CapsuleManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.manifest),
            "text": value.text,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsulePayload {
        if (this !== CapsulePayload_JsonCodec .lazyInstance.value) {
            return CapsulePayload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsulePayload (
            obj["scope"] as string,
            obj["workContext"] as string,
            ContextRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedContext"]),
            CapsuleCut_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["cut"]),
            obj["previousCapsuleId"] === undefined || obj["previousCapsuleId"] === null ? undefined : obj["previousCapsuleId"] === undefined || obj["previousCapsuleId"] === null ? undefined : obj["previousCapsuleId"] as string,
            CapsulePolicyIdentity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["policy"]),
            (obj["records"] as unknown[]).map(item => GraphRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            CapsuleManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["manifest"]),
            obj["text"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsulePayload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsulePayload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsulePayload'
    public baboonTypeIdentifier() {
        return CapsulePayload_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsulePayload_JsonCodec())
    public static get instance(): CapsulePayload_JsonCodec {
        return CapsulePayload_JsonCodec.lazyInstance.value
    }
}