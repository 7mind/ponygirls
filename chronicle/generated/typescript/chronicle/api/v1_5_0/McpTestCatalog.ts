import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {McpTestLimits, McpTestLimits_JsonCodec} from './McpTestLimits.js'
import {McpToolDefinition, McpToolDefinition_JsonCodec} from './McpToolDefinition.js'

export class McpTestCatalog implements BaboonGenerated {
    private readonly _instanceId: string;
    private readonly _model: string;
    private readonly _modelRevision: string;
    private readonly _maximumOutputTokens: number;
    private readonly _reasoningPolicy: string;
    private readonly _limits: McpTestLimits;
    private readonly _tools: Array<McpToolDefinition>;

    constructor(instanceId: string, model: string, modelRevision: string, maximumOutputTokens: number, reasoningPolicy: string, limits: McpTestLimits, tools: Array<McpToolDefinition>) {
        this._instanceId = instanceId
        this._model = model
        this._modelRevision = modelRevision
        this._maximumOutputTokens = maximumOutputTokens
        this._reasoningPolicy = reasoningPolicy
        this._limits = limits
        this._tools = tools
    }

    public get instanceId(): string {
        return this._instanceId;
    }
    public get model(): string {
        return this._model;
    }
    public get modelRevision(): string {
        return this._modelRevision;
    }
    public get maximumOutputTokens(): number {
        return this._maximumOutputTokens;
    }
    public get reasoningPolicy(): string {
        return this._reasoningPolicy;
    }
    public get limits(): McpTestLimits {
        return this._limits;
    }
    public get tools(): Array<McpToolDefinition> {
        return this._tools;
    }

    public toJSON(): Record<string, unknown> {
        return {
            instanceId: this._instanceId,
            model: this._model,
            modelRevision: this._modelRevision,
            maximumOutputTokens: this._maximumOutputTokens,
            reasoningPolicy: this._reasoningPolicy,
            limits: this._limits,
            tools: this._tools
        };
    }

    public with(overrides: {instanceId?: string; model?: string; modelRevision?: string; maximumOutputTokens?: number; reasoningPolicy?: string; limits?: McpTestLimits; tools?: Array<McpToolDefinition>}): McpTestCatalog {
        return new McpTestCatalog(
            'instanceId' in overrides ? overrides.instanceId! : this._instanceId,
            'model' in overrides ? overrides.model! : this._model,
            'modelRevision' in overrides ? overrides.modelRevision! : this._modelRevision,
            'maximumOutputTokens' in overrides ? overrides.maximumOutputTokens! : this._maximumOutputTokens,
            'reasoningPolicy' in overrides ? overrides.reasoningPolicy! : this._reasoningPolicy,
            'limits' in overrides ? overrides.limits! : this._limits,
            'tools' in overrides ? overrides.tools! : this._tools
        );
    }

    public static fromPlain(obj: {instanceId: string; model: string; modelRevision: string; maximumOutputTokens: number; reasoningPolicy: string; limits: McpTestLimits; tools: Array<McpToolDefinition>}): McpTestCatalog {
        return new McpTestCatalog(
            obj.instanceId,
            obj.model,
            obj.modelRevision,
            obj.maximumOutputTokens,
            obj.reasoningPolicy,
            obj.limits,
            obj.tools
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestCatalog.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestCatalog.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestCatalog'
    public baboonTypeIdentifier() {
        return McpTestCatalog.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return McpTestCatalog.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return McpTestCatalog.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestCatalog.BaboonMinReaderVersions
    }
    public static jsonCodec(): McpTestCatalog_JsonCodec {
        return McpTestCatalog_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestCatalog_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestCatalog): unknown {
        if (this !== McpTestCatalog_JsonCodec.lazyInstance.value) {
          return McpTestCatalog_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "instanceId": value.instanceId,
            "model": value.model,
            "modelRevision": value.modelRevision,
            "maximumOutputTokens": value.maximumOutputTokens,
            "reasoningPolicy": value.reasoningPolicy,
            "limits": McpTestLimits_JsonCodec.instance.encode(BaboonCodecContext.Default, value.limits),
            "tools": Array.from(value.tools).map(item => McpToolDefinition_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestCatalog {
        if (this !== McpTestCatalog_JsonCodec .lazyInstance.value) {
            return McpTestCatalog_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestCatalog (
            obj["instanceId"] as string,
            obj["model"] as string,
            obj["modelRevision"] as string,
            obj["maximumOutputTokens"] as number,
            obj["reasoningPolicy"] as string,
            McpTestLimits_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["limits"]),
            (obj["tools"] as unknown[]).map(item => McpToolDefinition_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestCatalog_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestCatalog_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestCatalog'
    public baboonTypeIdentifier() {
        return McpTestCatalog_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestCatalog_JsonCodec())
    public static get instance(): McpTestCatalog_JsonCodec {
        return McpTestCatalog_JsonCodec.lazyInstance.value
    }
}