import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class McpTestLimits implements BaboonGenerated {
    private readonly _maximumRounds: number;
    private readonly _maximumToolCalls: number;
    private readonly _maximumPromptBytes: number;
    private readonly _maximumSourceBytes: number;
    private readonly _maximumResultBytes: number;
    private readonly _maximumRequestBytes: number;
    private readonly _maximumTraceBytes: number;
    private readonly _maximumEvents: number;
    private readonly _pageBytes: number;
    private readonly _deadlineSeconds: number;
    private readonly _retentionSeconds: number;

    constructor(maximumRounds: number, maximumToolCalls: number, maximumPromptBytes: number, maximumSourceBytes: number, maximumResultBytes: number, maximumRequestBytes: number, maximumTraceBytes: number, maximumEvents: number, pageBytes: number, deadlineSeconds: number, retentionSeconds: number) {
        this._maximumRounds = maximumRounds
        this._maximumToolCalls = maximumToolCalls
        this._maximumPromptBytes = maximumPromptBytes
        this._maximumSourceBytes = maximumSourceBytes
        this._maximumResultBytes = maximumResultBytes
        this._maximumRequestBytes = maximumRequestBytes
        this._maximumTraceBytes = maximumTraceBytes
        this._maximumEvents = maximumEvents
        this._pageBytes = pageBytes
        this._deadlineSeconds = deadlineSeconds
        this._retentionSeconds = retentionSeconds
    }

    public get maximumRounds(): number {
        return this._maximumRounds;
    }
    public get maximumToolCalls(): number {
        return this._maximumToolCalls;
    }
    public get maximumPromptBytes(): number {
        return this._maximumPromptBytes;
    }
    public get maximumSourceBytes(): number {
        return this._maximumSourceBytes;
    }
    public get maximumResultBytes(): number {
        return this._maximumResultBytes;
    }
    public get maximumRequestBytes(): number {
        return this._maximumRequestBytes;
    }
    public get maximumTraceBytes(): number {
        return this._maximumTraceBytes;
    }
    public get maximumEvents(): number {
        return this._maximumEvents;
    }
    public get pageBytes(): number {
        return this._pageBytes;
    }
    public get deadlineSeconds(): number {
        return this._deadlineSeconds;
    }
    public get retentionSeconds(): number {
        return this._retentionSeconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            maximumRounds: this._maximumRounds,
            maximumToolCalls: this._maximumToolCalls,
            maximumPromptBytes: this._maximumPromptBytes,
            maximumSourceBytes: this._maximumSourceBytes,
            maximumResultBytes: this._maximumResultBytes,
            maximumRequestBytes: this._maximumRequestBytes,
            maximumTraceBytes: this._maximumTraceBytes,
            maximumEvents: this._maximumEvents,
            pageBytes: this._pageBytes,
            deadlineSeconds: this._deadlineSeconds,
            retentionSeconds: this._retentionSeconds
        };
    }

    public with(overrides: {maximumRounds?: number; maximumToolCalls?: number; maximumPromptBytes?: number; maximumSourceBytes?: number; maximumResultBytes?: number; maximumRequestBytes?: number; maximumTraceBytes?: number; maximumEvents?: number; pageBytes?: number; deadlineSeconds?: number; retentionSeconds?: number}): McpTestLimits {
        return new McpTestLimits(
            'maximumRounds' in overrides ? overrides.maximumRounds! : this._maximumRounds,
            'maximumToolCalls' in overrides ? overrides.maximumToolCalls! : this._maximumToolCalls,
            'maximumPromptBytes' in overrides ? overrides.maximumPromptBytes! : this._maximumPromptBytes,
            'maximumSourceBytes' in overrides ? overrides.maximumSourceBytes! : this._maximumSourceBytes,
            'maximumResultBytes' in overrides ? overrides.maximumResultBytes! : this._maximumResultBytes,
            'maximumRequestBytes' in overrides ? overrides.maximumRequestBytes! : this._maximumRequestBytes,
            'maximumTraceBytes' in overrides ? overrides.maximumTraceBytes! : this._maximumTraceBytes,
            'maximumEvents' in overrides ? overrides.maximumEvents! : this._maximumEvents,
            'pageBytes' in overrides ? overrides.pageBytes! : this._pageBytes,
            'deadlineSeconds' in overrides ? overrides.deadlineSeconds! : this._deadlineSeconds,
            'retentionSeconds' in overrides ? overrides.retentionSeconds! : this._retentionSeconds
        );
    }

    public static fromPlain(obj: {maximumRounds: number; maximumToolCalls: number; maximumPromptBytes: number; maximumSourceBytes: number; maximumResultBytes: number; maximumRequestBytes: number; maximumTraceBytes: number; maximumEvents: number; pageBytes: number; deadlineSeconds: number; retentionSeconds: number}): McpTestLimits {
        return new McpTestLimits(
            obj.maximumRounds,
            obj.maximumToolCalls,
            obj.maximumPromptBytes,
            obj.maximumSourceBytes,
            obj.maximumResultBytes,
            obj.maximumRequestBytes,
            obj.maximumTraceBytes,
            obj.maximumEvents,
            obj.pageBytes,
            obj.deadlineSeconds,
            obj.retentionSeconds
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return McpTestLimits.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestLimits.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestLimits'
    public baboonTypeIdentifier() {
        return McpTestLimits.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return McpTestLimits.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return McpTestLimits.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestLimits.BaboonMinReaderVersions
    }
    public static jsonCodec(): McpTestLimits_JsonCodec {
        return McpTestLimits_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.7.0 */
export class McpTestLimits_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestLimits): unknown {
        if (this !== McpTestLimits_JsonCodec.lazyInstance.value) {
          return McpTestLimits_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "maximumRounds": value.maximumRounds,
            "maximumToolCalls": value.maximumToolCalls,
            "maximumPromptBytes": value.maximumPromptBytes,
            "maximumSourceBytes": value.maximumSourceBytes,
            "maximumResultBytes": value.maximumResultBytes,
            "maximumRequestBytes": value.maximumRequestBytes,
            "maximumTraceBytes": value.maximumTraceBytes,
            "maximumEvents": value.maximumEvents,
            "pageBytes": value.pageBytes,
            "deadlineSeconds": value.deadlineSeconds,
            "retentionSeconds": value.retentionSeconds,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestLimits {
        if (this !== McpTestLimits_JsonCodec .lazyInstance.value) {
            return McpTestLimits_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestLimits (
            obj["maximumRounds"] as number,
            obj["maximumToolCalls"] as number,
            obj["maximumPromptBytes"] as number,
            obj["maximumSourceBytes"] as number,
            obj["maximumResultBytes"] as number,
            obj["maximumRequestBytes"] as number,
            obj["maximumTraceBytes"] as number,
            obj["maximumEvents"] as number,
            obj["pageBytes"] as number,
            obj["deadlineSeconds"] as number,
            obj["retentionSeconds"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return McpTestLimits_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestLimits_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestLimits'
    public baboonTypeIdentifier() {
        return McpTestLimits_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestLimits_JsonCodec())
    public static get instance(): McpTestLimits_JsonCodec {
        return McpTestLimits_JsonCodec.lazyInstance.value
    }
}