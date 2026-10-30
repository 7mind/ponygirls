import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {PassageSourceSpan, PassageSourceSpan_JsonCodec} from './PassageSourceSpan.js'

export class ContextExcerpt implements BaboonGeneratedLatest {
    private readonly _source: PassageSourceSpan;
    private readonly _role: string;
    private readonly _text: string;

    constructor(source: PassageSourceSpan, role: string, text: string) {
        this._source = source
        this._role = role
        this._text = text
    }

    public get source(): PassageSourceSpan {
        return this._source;
    }
    public get role(): string {
        return this._role;
    }
    public get text(): string {
        return this._text;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source,
            role: this._role,
            text: this._text
        };
    }

    public with(overrides: {source?: PassageSourceSpan; role?: string; text?: string}): ContextExcerpt {
        return new ContextExcerpt(
            'source' in overrides ? overrides.source! : this._source,
            'role' in overrides ? overrides.role! : this._role,
            'text' in overrides ? overrides.text! : this._text
        );
    }

    public static fromPlain(obj: {source: PassageSourceSpan; role: string; text: string}): ContextExcerpt {
        return new ContextExcerpt(
            obj.source,
            obj.role,
            obj.text
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ContextExcerpt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ContextExcerpt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ContextExcerpt'
    public baboonTypeIdentifier() {
        return ContextExcerpt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ContextExcerpt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ContextExcerpt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ContextExcerpt.BaboonMinReaderVersions
    }
    public static jsonCodec(): ContextExcerpt_JsonCodec {
        return ContextExcerpt_JsonCodec.instance
    }
}

export class ContextExcerpt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContextExcerpt): unknown {
        if (this !== ContextExcerpt_JsonCodec.lazyInstance.value) {
          return ContextExcerpt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": PassageSourceSpan_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "role": value.role,
            "text": value.text,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContextExcerpt {
        if (this !== ContextExcerpt_JsonCodec .lazyInstance.value) {
            return ContextExcerpt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContextExcerpt (
            PassageSourceSpan_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            obj["role"] as string,
            obj["text"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ContextExcerpt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ContextExcerpt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ContextExcerpt'
    public baboonTypeIdentifier() {
        return ContextExcerpt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContextExcerpt_JsonCodec())
    public static get instance(): ContextExcerpt_JsonCodec {
        return ContextExcerpt_JsonCodec.lazyInstance.value
    }
}