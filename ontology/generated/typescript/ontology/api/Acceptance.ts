import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class Acceptance implements BaboonGeneratedLatest {
    private readonly _clauses: Array<string>;
    private readonly _question: Ref | undefined;

    constructor(clauses: Array<string>, question: Ref | undefined) {
        this._clauses = clauses
        this._question = question
    }

    public get clauses(): Array<string> {
        return this._clauses;
    }
    public get question(): Ref | undefined {
        return this._question;
    }

    public toJSON(): Record<string, unknown> {
        return {
            clauses: this._clauses,
            question: this._question !== undefined ? this._question : undefined
        };
    }

    public with(overrides: {clauses?: Array<string>; question?: Ref | undefined}): Acceptance {
        return new Acceptance(
            'clauses' in overrides ? overrides.clauses! : this._clauses,
            'question' in overrides ? overrides.question! : this._question
        );
    }

    public static fromPlain(obj: {clauses: Array<string>; question: Ref | undefined}): Acceptance {
        return new Acceptance(
            obj.clauses,
            obj.question
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Acceptance.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Acceptance.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Acceptance'
    public baboonTypeIdentifier() {
        return Acceptance.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Acceptance.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Acceptance.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Acceptance.BaboonMinReaderVersions
    }
    public static jsonCodec(): Acceptance_JsonCodec {
        return Acceptance_JsonCodec.instance
    }
}

export class Acceptance_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Acceptance): unknown {
        if (this !== Acceptance_JsonCodec.lazyInstance.value) {
          return Acceptance_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "clauses": Array.from(value.clauses),
            "question": value.question === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.question),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Acceptance {
        if (this !== Acceptance_JsonCodec .lazyInstance.value) {
            return Acceptance_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Acceptance (
            (obj["clauses"] as unknown[]).map(item => item as string),
            obj["question"] === undefined || obj["question"] === null ? undefined : obj["question"] === undefined || obj["question"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["question"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Acceptance_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Acceptance_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Acceptance'
    public baboonTypeIdentifier() {
        return Acceptance_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Acceptance_JsonCodec())
    public static get instance(): Acceptance_JsonCodec {
        return Acceptance_JsonCodec.lazyInstance.value
    }
}