import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Target, Target_JsonCodec} from './Target.js'

export class AcceptanceInput implements BaboonGeneratedLatest {
    private readonly _clauses: Array<string>;
    private readonly _question: Target | undefined;

    constructor(clauses: Array<string>, question: Target | undefined) {
        this._clauses = clauses
        this._question = question
    }

    public get clauses(): Array<string> {
        return this._clauses;
    }
    public get question(): Target | undefined {
        return this._question;
    }

    public toJSON(): Record<string, unknown> {
        return {
            clauses: this._clauses,
            question: this._question !== undefined ? this._question : undefined
        };
    }

    public with(overrides: {clauses?: Array<string>; question?: Target | undefined}): AcceptanceInput {
        return new AcceptanceInput(
            'clauses' in overrides ? overrides.clauses! : this._clauses,
            'question' in overrides ? overrides.question! : this._question
        );
    }

    public static fromPlain(obj: {clauses: Array<string>; question: Target | undefined}): AcceptanceInput {
        return new AcceptanceInput(
            obj.clauses,
            obj.question
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AcceptanceInput.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AcceptanceInput.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AcceptanceInput'
    public baboonTypeIdentifier() {
        return AcceptanceInput.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return AcceptanceInput.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return AcceptanceInput.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return AcceptanceInput.BaboonMinReaderVersions
    }
    public static jsonCodec(): AcceptanceInput_JsonCodec {
        return AcceptanceInput_JsonCodec.instance
    }
}

export class AcceptanceInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: AcceptanceInput): unknown {
        if (this !== AcceptanceInput_JsonCodec.lazyInstance.value) {
          return AcceptanceInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "clauses": Array.from(value.clauses),
            "question": value.question === undefined ? null : Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.question),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): AcceptanceInput {
        if (this !== AcceptanceInput_JsonCodec .lazyInstance.value) {
            return AcceptanceInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new AcceptanceInput (
            (obj["clauses"] as unknown[]).map(item => item as string),
            obj["question"] === undefined || obj["question"] === null ? undefined : obj["question"] === undefined || obj["question"] === null ? undefined : Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["question"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AcceptanceInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AcceptanceInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AcceptanceInput'
    public baboonTypeIdentifier() {
        return AcceptanceInput_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new AcceptanceInput_JsonCodec())
    public static get instance(): AcceptanceInput_JsonCodec {
        return AcceptanceInput_JsonCodec.lazyInstance.value
    }
}