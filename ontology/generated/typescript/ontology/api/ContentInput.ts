import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {AcceptanceInput, AcceptanceInput_JsonCodec} from './AcceptanceInput.js'
import {Assessment, Assessment_JsonCodec} from './Assessment.js'
import {ConflictState, ConflictState_JsonCodec} from './ConflictState.js'
import {Correction, Correction_JsonCodec} from './Correction.js'
import {Escalation, Escalation_JsonCodec} from './Escalation.js'
import {Execution, Execution_JsonCodec} from './Execution.js'
import {Force, Force_JsonCodec} from './Force.js'
import {Modality, Modality_JsonCodec} from './Modality.js'
import {Polarity, Polarity_JsonCodec} from './Polarity.js'
import {Target, Target_JsonCodec} from './Target.js'

export type ContentInput = ContentInput_Outcome | ContentInput_Constraint | ContentInput_Task | ContentInput_Statement | ContentInput_Hypothesis | ContentInput_Defect | ContentInput_Question | ContentInput_Decision | ContentInput_Review | ContentInput_Conflict

export const ContentInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#ContentInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#ContentInput',
    jsonCodec(): ContentInput_JsonCodec {
        return ContentInput_JsonCodec.instance
    }
} as const

export class ContentInput_Outcome implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Outcome' as const;
    private readonly _text: string;
    private readonly _acceptance: AcceptanceInput;
    private readonly _force: Force;

    constructor(text: string, acceptance: AcceptanceInput, force: Force) {
        this._text = text
        this._acceptance = acceptance
        this._force = force
    }

    public get text(): string {
        return this._text;
    }
    public get acceptance(): AcceptanceInput {
        return this._acceptance;
    }
    public get force(): Force {
        return this._force;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            acceptance: this._acceptance,
            force: this._force
        };
    }

    public with(overrides: {text?: string; acceptance?: AcceptanceInput; force?: Force}): ContentInput_Outcome {
        return new ContentInput_Outcome(
            'text' in overrides ? overrides.text! : this._text,
            'acceptance' in overrides ? overrides.acceptance! : this._acceptance,
            'force' in overrides ? overrides.force! : this._force
        );
    }

    public static fromPlain(obj: {text: string; acceptance: AcceptanceInput; force: Force}): ContentInput_Outcome {
        return new ContentInput_Outcome(
            obj.text,
            obj.acceptance,
            obj.force
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Outcome.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Outcome.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Outcome'
    public baboonTypeIdentifier() {
        return ContentInput_Outcome.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Outcome.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Outcome.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Outcome.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Outcome.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Outcome_JsonCodec {
        return ContentInput_Outcome_JsonCodec.instance
    }
}

export class ContentInput_Outcome_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Outcome): unknown {
        if (this !== ContentInput_Outcome_JsonCodec.lazyInstance.value) {
          return ContentInput_Outcome_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "acceptance": AcceptanceInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.acceptance),
            "force": Force_JsonCodec.instance.encode(BaboonCodecContext.Default, value.force),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Outcome {
        if (this !== ContentInput_Outcome_JsonCodec .lazyInstance.value) {
            return ContentInput_Outcome_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Outcome (
            obj["text"] as string,
            AcceptanceInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["acceptance"]),
            Force_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["force"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Outcome_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Outcome_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Outcome'
    public baboonTypeIdentifier() {
        return ContentInput_Outcome_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Outcome_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Outcome_JsonCodec())
    public static get instance(): ContentInput_Outcome_JsonCodec {
        return ContentInput_Outcome_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Constraint implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Constraint' as const;
    private readonly _text: string;
    private readonly _polarity: Polarity;
    private readonly _force: Force;

    constructor(text: string, polarity: Polarity, force: Force) {
        this._text = text
        this._polarity = polarity
        this._force = force
    }

    public get text(): string {
        return this._text;
    }
    public get polarity(): Polarity {
        return this._polarity;
    }
    public get force(): Force {
        return this._force;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            polarity: this._polarity,
            force: this._force
        };
    }

    public with(overrides: {text?: string; polarity?: Polarity; force?: Force}): ContentInput_Constraint {
        return new ContentInput_Constraint(
            'text' in overrides ? overrides.text! : this._text,
            'polarity' in overrides ? overrides.polarity! : this._polarity,
            'force' in overrides ? overrides.force! : this._force
        );
    }

    public static fromPlain(obj: {text: string; polarity: Polarity; force: Force}): ContentInput_Constraint {
        return new ContentInput_Constraint(
            obj.text,
            obj.polarity,
            obj.force
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Constraint.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Constraint.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Constraint'
    public baboonTypeIdentifier() {
        return ContentInput_Constraint.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Constraint.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Constraint.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Constraint.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Constraint.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Constraint_JsonCodec {
        return ContentInput_Constraint_JsonCodec.instance
    }
}

export class ContentInput_Constraint_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Constraint): unknown {
        if (this !== ContentInput_Constraint_JsonCodec.lazyInstance.value) {
          return ContentInput_Constraint_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "polarity": Polarity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.polarity),
            "force": Force_JsonCodec.instance.encode(BaboonCodecContext.Default, value.force),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Constraint {
        if (this !== ContentInput_Constraint_JsonCodec .lazyInstance.value) {
            return ContentInput_Constraint_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Constraint (
            obj["text"] as string,
            Polarity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["polarity"]),
            Force_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["force"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Constraint_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Constraint_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Constraint'
    public baboonTypeIdentifier() {
        return ContentInput_Constraint_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Constraint_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Constraint_JsonCodec())
    public static get instance(): ContentInput_Constraint_JsonCodec {
        return ContentInput_Constraint_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Task implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Task' as const;
    private readonly _text: string;
    private readonly _acceptance: AcceptanceInput;
    private readonly _execution: Execution;

    constructor(text: string, acceptance: AcceptanceInput, execution: Execution) {
        this._text = text
        this._acceptance = acceptance
        this._execution = execution
    }

    public get text(): string {
        return this._text;
    }
    public get acceptance(): AcceptanceInput {
        return this._acceptance;
    }
    public get execution(): Execution {
        return this._execution;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            acceptance: this._acceptance,
            execution: this._execution
        };
    }

    public with(overrides: {text?: string; acceptance?: AcceptanceInput; execution?: Execution}): ContentInput_Task {
        return new ContentInput_Task(
            'text' in overrides ? overrides.text! : this._text,
            'acceptance' in overrides ? overrides.acceptance! : this._acceptance,
            'execution' in overrides ? overrides.execution! : this._execution
        );
    }

    public static fromPlain(obj: {text: string; acceptance: AcceptanceInput; execution: Execution}): ContentInput_Task {
        return new ContentInput_Task(
            obj.text,
            obj.acceptance,
            obj.execution
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Task.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Task.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Task'
    public baboonTypeIdentifier() {
        return ContentInput_Task.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Task.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Task.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Task.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Task.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Task_JsonCodec {
        return ContentInput_Task_JsonCodec.instance
    }
}

export class ContentInput_Task_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Task): unknown {
        if (this !== ContentInput_Task_JsonCodec.lazyInstance.value) {
          return ContentInput_Task_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "acceptance": AcceptanceInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.acceptance),
            "execution": Execution_JsonCodec.instance.encode(BaboonCodecContext.Default, value.execution),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Task {
        if (this !== ContentInput_Task_JsonCodec .lazyInstance.value) {
            return ContentInput_Task_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Task (
            obj["text"] as string,
            AcceptanceInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["acceptance"]),
            Execution_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["execution"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Task_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Task_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Task'
    public baboonTypeIdentifier() {
        return ContentInput_Task_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Task_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Task_JsonCodec())
    public static get instance(): ContentInput_Task_JsonCodec {
        return ContentInput_Task_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Statement implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Statement' as const;
    private readonly _text: string;
    private readonly _modality: Modality;

    constructor(text: string, modality: Modality) {
        this._text = text
        this._modality = modality
    }

    public get text(): string {
        return this._text;
    }
    public get modality(): Modality {
        return this._modality;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            modality: this._modality
        };
    }

    public with(overrides: {text?: string; modality?: Modality}): ContentInput_Statement {
        return new ContentInput_Statement(
            'text' in overrides ? overrides.text! : this._text,
            'modality' in overrides ? overrides.modality! : this._modality
        );
    }

    public static fromPlain(obj: {text: string; modality: Modality}): ContentInput_Statement {
        return new ContentInput_Statement(
            obj.text,
            obj.modality
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Statement.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Statement.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Statement'
    public baboonTypeIdentifier() {
        return ContentInput_Statement.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Statement.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Statement.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Statement.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Statement.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Statement_JsonCodec {
        return ContentInput_Statement_JsonCodec.instance
    }
}

export class ContentInput_Statement_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Statement): unknown {
        if (this !== ContentInput_Statement_JsonCodec.lazyInstance.value) {
          return ContentInput_Statement_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "modality": Modality_JsonCodec.instance.encode(BaboonCodecContext.Default, value.modality),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Statement {
        if (this !== ContentInput_Statement_JsonCodec .lazyInstance.value) {
            return ContentInput_Statement_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Statement (
            obj["text"] as string,
            Modality_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["modality"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Statement_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Statement_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Statement'
    public baboonTypeIdentifier() {
        return ContentInput_Statement_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Statement_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Statement_JsonCodec())
    public static get instance(): ContentInput_Statement_JsonCodec {
        return ContentInput_Statement_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Hypothesis implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Hypothesis' as const;
    private readonly _text: string;
    private readonly _prediction: string;

    constructor(text: string, prediction: string) {
        this._text = text
        this._prediction = prediction
    }

    public get text(): string {
        return this._text;
    }
    public get prediction(): string {
        return this._prediction;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            prediction: this._prediction
        };
    }

    public with(overrides: {text?: string; prediction?: string}): ContentInput_Hypothesis {
        return new ContentInput_Hypothesis(
            'text' in overrides ? overrides.text! : this._text,
            'prediction' in overrides ? overrides.prediction! : this._prediction
        );
    }

    public static fromPlain(obj: {text: string; prediction: string}): ContentInput_Hypothesis {
        return new ContentInput_Hypothesis(
            obj.text,
            obj.prediction
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Hypothesis.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Hypothesis.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Hypothesis'
    public baboonTypeIdentifier() {
        return ContentInput_Hypothesis.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Hypothesis.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Hypothesis.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Hypothesis.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Hypothesis.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Hypothesis_JsonCodec {
        return ContentInput_Hypothesis_JsonCodec.instance
    }
}

export class ContentInput_Hypothesis_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Hypothesis): unknown {
        if (this !== ContentInput_Hypothesis_JsonCodec.lazyInstance.value) {
          return ContentInput_Hypothesis_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "prediction": value.prediction,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Hypothesis {
        if (this !== ContentInput_Hypothesis_JsonCodec .lazyInstance.value) {
            return ContentInput_Hypothesis_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Hypothesis (
            obj["text"] as string,
            obj["prediction"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Hypothesis_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Hypothesis_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Hypothesis'
    public baboonTypeIdentifier() {
        return ContentInput_Hypothesis_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Hypothesis_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Hypothesis_JsonCodec())
    public static get instance(): ContentInput_Hypothesis_JsonCodec {
        return ContentInput_Hypothesis_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Defect implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Defect' as const;
    private readonly _text: string;
    private readonly _observed: string;
    private readonly _expected: string;
    private readonly _reproduction: string;
    private readonly _affected: Array<Target>;
    private readonly _correction: Correction;

    constructor(text: string, observed: string, expected: string, reproduction: string, affected: Array<Target>, correction: Correction) {
        this._text = text
        this._observed = observed
        this._expected = expected
        this._reproduction = reproduction
        this._affected = affected
        this._correction = correction
    }

    public get text(): string {
        return this._text;
    }
    public get observed(): string {
        return this._observed;
    }
    public get expected(): string {
        return this._expected;
    }
    public get reproduction(): string {
        return this._reproduction;
    }
    public get affected(): Array<Target> {
        return this._affected;
    }
    public get correction(): Correction {
        return this._correction;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            observed: this._observed,
            expected: this._expected,
            reproduction: this._reproduction,
            affected: this._affected,
            correction: this._correction
        };
    }

    public with(overrides: {text?: string; observed?: string; expected?: string; reproduction?: string; affected?: Array<Target>; correction?: Correction}): ContentInput_Defect {
        return new ContentInput_Defect(
            'text' in overrides ? overrides.text! : this._text,
            'observed' in overrides ? overrides.observed! : this._observed,
            'expected' in overrides ? overrides.expected! : this._expected,
            'reproduction' in overrides ? overrides.reproduction! : this._reproduction,
            'affected' in overrides ? overrides.affected! : this._affected,
            'correction' in overrides ? overrides.correction! : this._correction
        );
    }

    public static fromPlain(obj: {text: string; observed: string; expected: string; reproduction: string; affected: Array<Target>; correction: Correction}): ContentInput_Defect {
        return new ContentInput_Defect(
            obj.text,
            obj.observed,
            obj.expected,
            obj.reproduction,
            obj.affected,
            obj.correction
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Defect.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Defect.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Defect'
    public baboonTypeIdentifier() {
        return ContentInput_Defect.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Defect.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Defect.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Defect.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Defect.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Defect_JsonCodec {
        return ContentInput_Defect_JsonCodec.instance
    }
}

export class ContentInput_Defect_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Defect): unknown {
        if (this !== ContentInput_Defect_JsonCodec.lazyInstance.value) {
          return ContentInput_Defect_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "observed": value.observed,
            "expected": value.expected,
            "reproduction": value.reproduction,
            "affected": Array.from(value.affected).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "correction": Correction_JsonCodec.instance.encode(BaboonCodecContext.Default, value.correction),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Defect {
        if (this !== ContentInput_Defect_JsonCodec .lazyInstance.value) {
            return ContentInput_Defect_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Defect (
            obj["text"] as string,
            obj["observed"] as string,
            obj["expected"] as string,
            obj["reproduction"] as string,
            (obj["affected"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            Correction_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["correction"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Defect_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Defect_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Defect'
    public baboonTypeIdentifier() {
        return ContentInput_Defect_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Defect_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Defect_JsonCodec())
    public static get instance(): ContentInput_Defect_JsonCodec {
        return ContentInput_Defect_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Question implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Question' as const;
    private readonly _text: string;
    private readonly _alternatives: Array<string>;
    private readonly _answer: string | undefined;
    private readonly _escalation: Escalation;

    constructor(text: string, alternatives: Array<string>, answer: string | undefined, escalation: Escalation) {
        this._text = text
        this._alternatives = alternatives
        this._answer = answer
        this._escalation = escalation
    }

    public get text(): string {
        return this._text;
    }
    public get alternatives(): Array<string> {
        return this._alternatives;
    }
    public get answer(): string | undefined {
        return this._answer;
    }
    public get escalation(): Escalation {
        return this._escalation;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            alternatives: this._alternatives,
            answer: this._answer !== undefined ? this._answer : undefined,
            escalation: this._escalation
        };
    }

    public with(overrides: {text?: string; alternatives?: Array<string>; answer?: string | undefined; escalation?: Escalation}): ContentInput_Question {
        return new ContentInput_Question(
            'text' in overrides ? overrides.text! : this._text,
            'alternatives' in overrides ? overrides.alternatives! : this._alternatives,
            'answer' in overrides ? overrides.answer! : this._answer,
            'escalation' in overrides ? overrides.escalation! : this._escalation
        );
    }

    public static fromPlain(obj: {text: string; alternatives: Array<string>; answer: string | undefined; escalation: Escalation}): ContentInput_Question {
        return new ContentInput_Question(
            obj.text,
            obj.alternatives,
            obj.answer,
            obj.escalation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Question.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Question.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Question'
    public baboonTypeIdentifier() {
        return ContentInput_Question.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Question.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Question.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Question.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Question.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Question_JsonCodec {
        return ContentInput_Question_JsonCodec.instance
    }
}

export class ContentInput_Question_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Question): unknown {
        if (this !== ContentInput_Question_JsonCodec.lazyInstance.value) {
          return ContentInput_Question_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "alternatives": Array.from(value.alternatives),
            "answer": value.answer === undefined ? null : value.answer,
            "escalation": Escalation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.escalation),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Question {
        if (this !== ContentInput_Question_JsonCodec .lazyInstance.value) {
            return ContentInput_Question_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Question (
            obj["text"] as string,
            (obj["alternatives"] as unknown[]).map(item => item as string),
            obj["answer"] === undefined || obj["answer"] === null ? undefined : obj["answer"] === undefined || obj["answer"] === null ? undefined : obj["answer"] as string,
            Escalation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["escalation"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Question_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Question_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Question'
    public baboonTypeIdentifier() {
        return ContentInput_Question_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Question_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Question_JsonCodec())
    public static get instance(): ContentInput_Question_JsonCodec {
        return ContentInput_Question_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Decision implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Decision' as const;
    private readonly _text: string;
    private readonly _alternatives: Array<string>;
    private readonly _rationale: string;

    constructor(text: string, alternatives: Array<string>, rationale: string) {
        this._text = text
        this._alternatives = alternatives
        this._rationale = rationale
    }

    public get text(): string {
        return this._text;
    }
    public get alternatives(): Array<string> {
        return this._alternatives;
    }
    public get rationale(): string {
        return this._rationale;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            alternatives: this._alternatives,
            rationale: this._rationale
        };
    }

    public with(overrides: {text?: string; alternatives?: Array<string>; rationale?: string}): ContentInput_Decision {
        return new ContentInput_Decision(
            'text' in overrides ? overrides.text! : this._text,
            'alternatives' in overrides ? overrides.alternatives! : this._alternatives,
            'rationale' in overrides ? overrides.rationale! : this._rationale
        );
    }

    public static fromPlain(obj: {text: string; alternatives: Array<string>; rationale: string}): ContentInput_Decision {
        return new ContentInput_Decision(
            obj.text,
            obj.alternatives,
            obj.rationale
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Decision.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Decision.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Decision'
    public baboonTypeIdentifier() {
        return ContentInput_Decision.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Decision.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Decision.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Decision.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Decision.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Decision_JsonCodec {
        return ContentInput_Decision_JsonCodec.instance
    }
}

export class ContentInput_Decision_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Decision): unknown {
        if (this !== ContentInput_Decision_JsonCodec.lazyInstance.value) {
          return ContentInput_Decision_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "alternatives": Array.from(value.alternatives),
            "rationale": value.rationale,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Decision {
        if (this !== ContentInput_Decision_JsonCodec .lazyInstance.value) {
            return ContentInput_Decision_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Decision (
            obj["text"] as string,
            (obj["alternatives"] as unknown[]).map(item => item as string),
            obj["rationale"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Decision_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Decision_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Decision'
    public baboonTypeIdentifier() {
        return ContentInput_Decision_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Decision_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Decision_JsonCodec())
    public static get instance(): ContentInput_Decision_JsonCodec {
        return ContentInput_Decision_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Review implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Review' as const;
    private readonly _text: string;
    private readonly _findings: Array<string>;
    private readonly _subjects: Array<Target>;
    private readonly _basis: Array<Target>;
    private readonly _uncertainty: string;
    private readonly _assessment: Assessment;

    constructor(text: string, findings: Array<string>, subjects: Array<Target>, basis: Array<Target>, uncertainty: string, assessment: Assessment) {
        this._text = text
        this._findings = findings
        this._subjects = subjects
        this._basis = basis
        this._uncertainty = uncertainty
        this._assessment = assessment
    }

    public get text(): string {
        return this._text;
    }
    public get findings(): Array<string> {
        return this._findings;
    }
    public get subjects(): Array<Target> {
        return this._subjects;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }
    public get uncertainty(): string {
        return this._uncertainty;
    }
    public get assessment(): Assessment {
        return this._assessment;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            findings: this._findings,
            subjects: this._subjects,
            basis: this._basis,
            uncertainty: this._uncertainty,
            assessment: this._assessment
        };
    }

    public with(overrides: {text?: string; findings?: Array<string>; subjects?: Array<Target>; basis?: Array<Target>; uncertainty?: string; assessment?: Assessment}): ContentInput_Review {
        return new ContentInput_Review(
            'text' in overrides ? overrides.text! : this._text,
            'findings' in overrides ? overrides.findings! : this._findings,
            'subjects' in overrides ? overrides.subjects! : this._subjects,
            'basis' in overrides ? overrides.basis! : this._basis,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty,
            'assessment' in overrides ? overrides.assessment! : this._assessment
        );
    }

    public static fromPlain(obj: {text: string; findings: Array<string>; subjects: Array<Target>; basis: Array<Target>; uncertainty: string; assessment: Assessment}): ContentInput_Review {
        return new ContentInput_Review(
            obj.text,
            obj.findings,
            obj.subjects,
            obj.basis,
            obj.uncertainty,
            obj.assessment
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Review.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Review.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Review'
    public baboonTypeIdentifier() {
        return ContentInput_Review.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Review.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Review.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Review.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Review.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Review_JsonCodec {
        return ContentInput_Review_JsonCodec.instance
    }
}

export class ContentInput_Review_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Review): unknown {
        if (this !== ContentInput_Review_JsonCodec.lazyInstance.value) {
          return ContentInput_Review_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "findings": Array.from(value.findings),
            "subjects": Array.from(value.subjects).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "uncertainty": value.uncertainty,
            "assessment": Assessment_JsonCodec.instance.encode(BaboonCodecContext.Default, value.assessment),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Review {
        if (this !== ContentInput_Review_JsonCodec .lazyInstance.value) {
            return ContentInput_Review_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Review (
            obj["text"] as string,
            (obj["findings"] as unknown[]).map(item => item as string),
            (obj["subjects"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["uncertainty"] as string,
            Assessment_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["assessment"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Review_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Review_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Review'
    public baboonTypeIdentifier() {
        return ContentInput_Review_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Review_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Review_JsonCodec())
    public static get instance(): ContentInput_Review_JsonCodec {
        return ContentInput_Review_JsonCodec.lazyInstance.value
    }
}

export class ContentInput_Conflict implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ContentInput]#Conflict' as const;
    private readonly _text: string;
    private readonly _subjects: Array<Target>;
    private readonly _status: ConflictState;
    private readonly _resolution: string | undefined;
    private readonly _uncertainty: string;

    constructor(text: string, subjects: Array<Target>, status: ConflictState, resolution: string | undefined, uncertainty: string) {
        this._text = text
        this._subjects = subjects
        this._status = status
        this._resolution = resolution
        this._uncertainty = uncertainty
    }

    public get text(): string {
        return this._text;
    }
    public get subjects(): Array<Target> {
        return this._subjects;
    }
    public get status(): ConflictState {
        return this._status;
    }
    public get resolution(): string | undefined {
        return this._resolution;
    }
    public get uncertainty(): string {
        return this._uncertainty;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            subjects: this._subjects,
            status: this._status,
            resolution: this._resolution !== undefined ? this._resolution : undefined,
            uncertainty: this._uncertainty
        };
    }

    public with(overrides: {text?: string; subjects?: Array<Target>; status?: ConflictState; resolution?: string | undefined; uncertainty?: string}): ContentInput_Conflict {
        return new ContentInput_Conflict(
            'text' in overrides ? overrides.text! : this._text,
            'subjects' in overrides ? overrides.subjects! : this._subjects,
            'status' in overrides ? overrides.status! : this._status,
            'resolution' in overrides ? overrides.resolution! : this._resolution,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty
        );
    }

    public static fromPlain(obj: {text: string; subjects: Array<Target>; status: ConflictState; resolution: string | undefined; uncertainty: string}): ContentInput_Conflict {
        return new ContentInput_Conflict(
            obj.text,
            obj.subjects,
            obj.status,
            obj.resolution,
            obj.uncertainty
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Conflict.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Conflict.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Conflict'
    public baboonTypeIdentifier() {
        return ContentInput_Conflict.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContentInput_Conflict.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContentInput_Conflict.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContentInput_Conflict.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Conflict.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentInput_Conflict_JsonCodec {
        return ContentInput_Conflict_JsonCodec.instance
    }
}

export class ContentInput_Conflict_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput_Conflict): unknown {
        if (this !== ContentInput_Conflict_JsonCodec.lazyInstance.value) {
          return ContentInput_Conflict_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "subjects": Array.from(value.subjects).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "status": ConflictState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.status),
            "resolution": value.resolution === undefined ? null : value.resolution,
            "uncertainty": value.uncertainty,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput_Conflict {
        if (this !== ContentInput_Conflict_JsonCodec .lazyInstance.value) {
            return ContentInput_Conflict_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentInput_Conflict (
            obj["text"] as string,
            (obj["subjects"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            ConflictState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["status"]),
            obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] as string,
            obj["uncertainty"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_Conflict_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_Conflict_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ContentInput]#Conflict'
    public baboonTypeIdentifier() {
        return ContentInput_Conflict_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_Conflict_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_Conflict_JsonCodec())
    public static get instance(): ContentInput_Conflict_JsonCodec {
        return ContentInput_Conflict_JsonCodec.lazyInstance.value
    }
}


export class ContentInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentInput): unknown {
        if (this !== ContentInput_JsonCodec.lazyInstance.value) {
          return ContentInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ContentInput_Outcome) {
                return { "Outcome": ContentInput_Outcome_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Constraint) {
                return { "Constraint": ContentInput_Constraint_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Task) {
                return { "Task": ContentInput_Task_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Statement) {
                return { "Statement": ContentInput_Statement_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Hypothesis) {
                return { "Hypothesis": ContentInput_Hypothesis_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Defect) {
                return { "Defect": ContentInput_Defect_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Question) {
                return { "Question": ContentInput_Question_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Decision) {
                return { "Decision": ContentInput_Decision_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Review) {
                return { "Review": ContentInput_Review_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentInput_Conflict) {
                return { "Conflict": ContentInput_Conflict_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentInput {
        if (this !== ContentInput_JsonCodec .lazyInstance.value) {
            return ContentInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Outcome": return ContentInput_Outcome_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Constraint": return ContentInput_Constraint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Task": return ContentInput_Task_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Statement": return ContentInput_Statement_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Hypothesis": return ContentInput_Hypothesis_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Defect": return ContentInput_Defect_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Question": return ContentInput_Question_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Decision": return ContentInput_Decision_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Review": return ContentInput_Review_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Conflict": return ContentInput_Conflict_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContentInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContentInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonTypeIdentifier() {
        return ContentInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ContentInput'
    public baboonAdtTypeIdentifier() {
        return ContentInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentInput_JsonCodec())
    public static get instance(): ContentInput_JsonCodec {
        return ContentInput_JsonCodec.lazyInstance.value
    }
}