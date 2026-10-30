import {type BaboonAdtMemberMeta, type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export type McpTestItem = McpTestItem_ToolCall | McpTestItem_ToolResult | McpTestItem_Response

export const McpTestItem = {
    BaboonDomainVersion: '1.5.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#McpTestItem',
    BaboonSameInVersions: ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"],
    BaboonForwardReadable: { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'chronicle.api/:#McpTestItem',
    jsonCodec(): McpTestItem_JsonCodec {
        return McpTestItem_JsonCodec.instance
    }
} as const

export class McpTestItem_ToolCall implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall' as const;
    private readonly _callId: string;
    private readonly _tool: string;
    private readonly _partIndex: number;
    private readonly _partCount: number;
    private readonly _argumentsJsonPart: string;

    constructor(callId: string, tool: string, partIndex: number, partCount: number, argumentsJsonPart: string) {
        this._callId = callId
        this._tool = tool
        this._partIndex = partIndex
        this._partCount = partCount
        this._argumentsJsonPart = argumentsJsonPart
    }

    public get callId(): string {
        return this._callId;
    }
    public get tool(): string {
        return this._tool;
    }
    public get partIndex(): number {
        return this._partIndex;
    }
    public get partCount(): number {
        return this._partCount;
    }
    public get argumentsJsonPart(): string {
        return this._argumentsJsonPart;
    }

    public toJSON(): Record<string, unknown> {
        return {
            callId: this._callId,
            tool: this._tool,
            partIndex: this._partIndex,
            partCount: this._partCount,
            argumentsJsonPart: this._argumentsJsonPart
        };
    }

    public with(overrides: {callId?: string; tool?: string; partIndex?: number; partCount?: number; argumentsJsonPart?: string}): McpTestItem_ToolCall {
        return new McpTestItem_ToolCall(
            'callId' in overrides ? overrides.callId! : this._callId,
            'tool' in overrides ? overrides.tool! : this._tool,
            'partIndex' in overrides ? overrides.partIndex! : this._partIndex,
            'partCount' in overrides ? overrides.partCount! : this._partCount,
            'argumentsJsonPart' in overrides ? overrides.argumentsJsonPart! : this._argumentsJsonPart
        );
    }

    public static fromPlain(obj: {callId: string; tool: string; partIndex: number; partCount: number; argumentsJsonPart: string}): McpTestItem_ToolCall {
        return new McpTestItem_ToolCall(
            obj.callId,
            obj.tool,
            obj.partIndex,
            obj.partCount,
            obj.argumentsJsonPart
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_ToolCall.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_ToolCall.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall'
    public baboonTypeIdentifier() {
        return McpTestItem_ToolCall.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return McpTestItem_ToolCall.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return McpTestItem_ToolCall.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestItem_ToolCall.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_ToolCall.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): McpTestItem_ToolCall_JsonCodec {
        return McpTestItem_ToolCall_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestItem_ToolCall_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestItem_ToolCall): unknown {
        if (this !== McpTestItem_ToolCall_JsonCodec.lazyInstance.value) {
          return McpTestItem_ToolCall_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "callId": value.callId,
            "tool": value.tool,
            "partIndex": value.partIndex,
            "partCount": value.partCount,
            "argumentsJsonPart": value.argumentsJsonPart,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestItem_ToolCall {
        if (this !== McpTestItem_ToolCall_JsonCodec .lazyInstance.value) {
            return McpTestItem_ToolCall_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestItem_ToolCall (
            obj["callId"] as string,
            obj["tool"] as string,
            obj["partIndex"] as number,
            obj["partCount"] as number,
            obj["argumentsJsonPart"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_ToolCall_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_ToolCall_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall'
    public baboonTypeIdentifier() {
        return McpTestItem_ToolCall_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_ToolCall_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestItem_ToolCall_JsonCodec())
    public static get instance(): McpTestItem_ToolCall_JsonCodec {
        return McpTestItem_ToolCall_JsonCodec.lazyInstance.value
    }
}

export class McpTestItem_ToolResult implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult' as const;
    private readonly _callId: string;
    private readonly _partIndex: number;
    private readonly _partCount: number;
    private readonly _resultJsonPart: string;

    constructor(callId: string, partIndex: number, partCount: number, resultJsonPart: string) {
        this._callId = callId
        this._partIndex = partIndex
        this._partCount = partCount
        this._resultJsonPart = resultJsonPart
    }

    public get callId(): string {
        return this._callId;
    }
    public get partIndex(): number {
        return this._partIndex;
    }
    public get partCount(): number {
        return this._partCount;
    }
    public get resultJsonPart(): string {
        return this._resultJsonPart;
    }

    public toJSON(): Record<string, unknown> {
        return {
            callId: this._callId,
            partIndex: this._partIndex,
            partCount: this._partCount,
            resultJsonPart: this._resultJsonPart
        };
    }

    public with(overrides: {callId?: string; partIndex?: number; partCount?: number; resultJsonPart?: string}): McpTestItem_ToolResult {
        return new McpTestItem_ToolResult(
            'callId' in overrides ? overrides.callId! : this._callId,
            'partIndex' in overrides ? overrides.partIndex! : this._partIndex,
            'partCount' in overrides ? overrides.partCount! : this._partCount,
            'resultJsonPart' in overrides ? overrides.resultJsonPart! : this._resultJsonPart
        );
    }

    public static fromPlain(obj: {callId: string; partIndex: number; partCount: number; resultJsonPart: string}): McpTestItem_ToolResult {
        return new McpTestItem_ToolResult(
            obj.callId,
            obj.partIndex,
            obj.partCount,
            obj.resultJsonPart
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_ToolResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_ToolResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult'
    public baboonTypeIdentifier() {
        return McpTestItem_ToolResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return McpTestItem_ToolResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return McpTestItem_ToolResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestItem_ToolResult.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_ToolResult.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): McpTestItem_ToolResult_JsonCodec {
        return McpTestItem_ToolResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestItem_ToolResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestItem_ToolResult): unknown {
        if (this !== McpTestItem_ToolResult_JsonCodec.lazyInstance.value) {
          return McpTestItem_ToolResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "callId": value.callId,
            "partIndex": value.partIndex,
            "partCount": value.partCount,
            "resultJsonPart": value.resultJsonPart,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestItem_ToolResult {
        if (this !== McpTestItem_ToolResult_JsonCodec .lazyInstance.value) {
            return McpTestItem_ToolResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestItem_ToolResult (
            obj["callId"] as string,
            obj["partIndex"] as number,
            obj["partCount"] as number,
            obj["resultJsonPart"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_ToolResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_ToolResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult'
    public baboonTypeIdentifier() {
        return McpTestItem_ToolResult_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_ToolResult_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestItem_ToolResult_JsonCodec())
    public static get instance(): McpTestItem_ToolResult_JsonCodec {
        return McpTestItem_ToolResult_JsonCodec.lazyInstance.value
    }
}

export class McpTestItem_Response implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#McpTestItem]#Response' as const;
    private readonly _partIndex: number;
    private readonly _partCount: number;
    private readonly _textPart: string;

    constructor(partIndex: number, partCount: number, textPart: string) {
        this._partIndex = partIndex
        this._partCount = partCount
        this._textPart = textPart
    }

    public get partIndex(): number {
        return this._partIndex;
    }
    public get partCount(): number {
        return this._partCount;
    }
    public get textPart(): string {
        return this._textPart;
    }

    public toJSON(): Record<string, unknown> {
        return {
            partIndex: this._partIndex,
            partCount: this._partCount,
            textPart: this._textPart
        };
    }

    public with(overrides: {partIndex?: number; partCount?: number; textPart?: string}): McpTestItem_Response {
        return new McpTestItem_Response(
            'partIndex' in overrides ? overrides.partIndex! : this._partIndex,
            'partCount' in overrides ? overrides.partCount! : this._partCount,
            'textPart' in overrides ? overrides.textPart! : this._textPart
        );
    }

    public static fromPlain(obj: {partIndex: number; partCount: number; textPart: string}): McpTestItem_Response {
        return new McpTestItem_Response(
            obj.partIndex,
            obj.partCount,
            obj.textPart
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_Response.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_Response.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#Response'
    public baboonTypeIdentifier() {
        return McpTestItem_Response.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return McpTestItem_Response.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return McpTestItem_Response.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestItem_Response.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_Response.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): McpTestItem_Response_JsonCodec {
        return McpTestItem_Response_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestItem_Response_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestItem_Response): unknown {
        if (this !== McpTestItem_Response_JsonCodec.lazyInstance.value) {
          return McpTestItem_Response_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "partIndex": value.partIndex,
            "partCount": value.partCount,
            "textPart": value.textPart,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestItem_Response {
        if (this !== McpTestItem_Response_JsonCodec .lazyInstance.value) {
            return McpTestItem_Response_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestItem_Response (
            obj["partIndex"] as number,
            obj["partCount"] as number,
            obj["textPart"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_Response_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_Response_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#McpTestItem]#Response'
    public baboonTypeIdentifier() {
        return McpTestItem_Response_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_Response_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestItem_Response_JsonCodec())
    public static get instance(): McpTestItem_Response_JsonCodec {
        return McpTestItem_Response_JsonCodec.lazyInstance.value
    }
}


/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestItem_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestItem): unknown {
        if (this !== McpTestItem_JsonCodec.lazyInstance.value) {
          return McpTestItem_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof McpTestItem_ToolCall) {
                return { "ToolCall": McpTestItem_ToolCall_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof McpTestItem_ToolResult) {
                return { "ToolResult": McpTestItem_ToolResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof McpTestItem_Response) {
                return { "Response": McpTestItem_Response_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestItem {
        if (this !== McpTestItem_JsonCodec .lazyInstance.value) {
            return McpTestItem_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "ToolCall": return McpTestItem_ToolCall_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ToolResult": return McpTestItem_ToolResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Response": return McpTestItem_Response_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestItem_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestItem_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonTypeIdentifier() {
        return McpTestItem_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#McpTestItem'
    public baboonAdtTypeIdentifier() {
        return McpTestItem_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestItem_JsonCodec())
    public static get instance(): McpTestItem_JsonCodec {
        return McpTestItem_JsonCodec.lazyInstance.value
    }
}