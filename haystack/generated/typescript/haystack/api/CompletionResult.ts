import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class CompletionResult implements BaboonGeneratedLatest {
    private readonly _suggestions: Array<string>;

    constructor(suggestions: Array<string>) {
        this._suggestions = suggestions
    }

    public get suggestions(): Array<string> {
        return this._suggestions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            suggestions: this._suggestions
        };
    }

    public with(overrides: {suggestions?: Array<string>}): CompletionResult {
        return new CompletionResult(
            'suggestions' in overrides ? overrides.suggestions! : this._suggestions
        );
    }

    public static fromPlain(obj: {suggestions: Array<string>}): CompletionResult {
        return new CompletionResult(
            obj.suggestions
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CompletionResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return CompletionResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#CompletionResult'
    public baboonTypeIdentifier() {
        return CompletionResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return CompletionResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return CompletionResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return CompletionResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): CompletionResult_JsonCodec {
        return CompletionResult_JsonCodec.instance
    }
}

export class CompletionResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CompletionResult): unknown {
        if (this !== CompletionResult_JsonCodec.lazyInstance.value) {
          return CompletionResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "suggestions": Array.from(value.suggestions),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CompletionResult {
        if (this !== CompletionResult_JsonCodec .lazyInstance.value) {
            return CompletionResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CompletionResult (
            (obj["suggestions"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CompletionResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return CompletionResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#CompletionResult'
    public baboonTypeIdentifier() {
        return CompletionResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CompletionResult_JsonCodec())
    public static get instance(): CompletionResult_JsonCodec {
        return CompletionResult_JsonCodec.lazyInstance.value
    }
}