import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Acceptance, Acceptance_JsonCodec} from './Acceptance.js'
import {Assessment, Assessment_JsonCodec} from './Assessment.js'
import {ConflictState, ConflictState_JsonCodec} from './ConflictState.js'
import {Correction, Correction_JsonCodec} from './Correction.js'
import {Escalation, Escalation_JsonCodec} from './Escalation.js'
import {Execution, Execution_JsonCodec} from './Execution.js'
import {Force, Force_JsonCodec} from './Force.js'
import {Modality, Modality_JsonCodec} from './Modality.js'
import {Polarity, Polarity_JsonCodec} from './Polarity.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type Content = Content_Outcome | Content_Constraint | Content_Task | Content_Statement | Content_Hypothesis | Content_Defect | Content_Question | Content_Decision | Content_Review | Content_Source | Content_Artifact | Content_Conflict

export const Content = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#Content',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#Content',
    jsonCodec(): Content_JsonCodec {
        return Content_JsonCodec.instance
    }
} as const

export class Content_Outcome implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Outcome' as const;
    private readonly _text: string;
    private readonly _acceptance: Acceptance;
    private readonly _force: Force;

    constructor(text: string, acceptance: Acceptance, force: Force) {
        this._text = text
        this._acceptance = acceptance
        this._force = force
    }

    public get text(): string {
        return this._text;
    }
    public get acceptance(): Acceptance {
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

    public with(overrides: {text?: string; acceptance?: Acceptance; force?: Force}): Content_Outcome {
        return new Content_Outcome(
            'text' in overrides ? overrides.text! : this._text,
            'acceptance' in overrides ? overrides.acceptance! : this._acceptance,
            'force' in overrides ? overrides.force! : this._force
        );
    }

    public static fromPlain(obj: {text: string; acceptance: Acceptance; force: Force}): Content_Outcome {
        return new Content_Outcome(
            obj.text,
            obj.acceptance,
            obj.force
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Outcome.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Outcome.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Outcome'
    public baboonTypeIdentifier() {
        return Content_Outcome.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Outcome.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Outcome.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Outcome.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Outcome.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Outcome_JsonCodec {
        return Content_Outcome_JsonCodec.instance
    }
}

export class Content_Outcome_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Outcome): unknown {
        if (this !== Content_Outcome_JsonCodec.lazyInstance.value) {
          return Content_Outcome_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "acceptance": Acceptance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.acceptance),
            "force": Force_JsonCodec.instance.encode(BaboonCodecContext.Default, value.force),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Outcome {
        if (this !== Content_Outcome_JsonCodec .lazyInstance.value) {
            return Content_Outcome_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Outcome (
            obj["text"] as string,
            Acceptance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["acceptance"]),
            Force_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["force"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Outcome_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Outcome_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Outcome'
    public baboonTypeIdentifier() {
        return Content_Outcome_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Outcome_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Outcome_JsonCodec())
    public static get instance(): Content_Outcome_JsonCodec {
        return Content_Outcome_JsonCodec.lazyInstance.value
    }
}

export class Content_Constraint implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Constraint' as const;
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

    public with(overrides: {text?: string; polarity?: Polarity; force?: Force}): Content_Constraint {
        return new Content_Constraint(
            'text' in overrides ? overrides.text! : this._text,
            'polarity' in overrides ? overrides.polarity! : this._polarity,
            'force' in overrides ? overrides.force! : this._force
        );
    }

    public static fromPlain(obj: {text: string; polarity: Polarity; force: Force}): Content_Constraint {
        return new Content_Constraint(
            obj.text,
            obj.polarity,
            obj.force
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Constraint.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Constraint.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Constraint'
    public baboonTypeIdentifier() {
        return Content_Constraint.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Constraint.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Constraint.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Constraint.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Constraint.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Constraint_JsonCodec {
        return Content_Constraint_JsonCodec.instance
    }
}

export class Content_Constraint_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Constraint): unknown {
        if (this !== Content_Constraint_JsonCodec.lazyInstance.value) {
          return Content_Constraint_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "polarity": Polarity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.polarity),
            "force": Force_JsonCodec.instance.encode(BaboonCodecContext.Default, value.force),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Constraint {
        if (this !== Content_Constraint_JsonCodec .lazyInstance.value) {
            return Content_Constraint_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Constraint (
            obj["text"] as string,
            Polarity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["polarity"]),
            Force_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["force"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Constraint_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Constraint_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Constraint'
    public baboonTypeIdentifier() {
        return Content_Constraint_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Constraint_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Constraint_JsonCodec())
    public static get instance(): Content_Constraint_JsonCodec {
        return Content_Constraint_JsonCodec.lazyInstance.value
    }
}

export class Content_Task implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Task' as const;
    private readonly _text: string;
    private readonly _acceptance: Acceptance;
    private readonly _execution: Execution;

    constructor(text: string, acceptance: Acceptance, execution: Execution) {
        this._text = text
        this._acceptance = acceptance
        this._execution = execution
    }

    public get text(): string {
        return this._text;
    }
    public get acceptance(): Acceptance {
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

    public with(overrides: {text?: string; acceptance?: Acceptance; execution?: Execution}): Content_Task {
        return new Content_Task(
            'text' in overrides ? overrides.text! : this._text,
            'acceptance' in overrides ? overrides.acceptance! : this._acceptance,
            'execution' in overrides ? overrides.execution! : this._execution
        );
    }

    public static fromPlain(obj: {text: string; acceptance: Acceptance; execution: Execution}): Content_Task {
        return new Content_Task(
            obj.text,
            obj.acceptance,
            obj.execution
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Task.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Task.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Task'
    public baboonTypeIdentifier() {
        return Content_Task.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Task.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Task.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Task.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Task.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Task_JsonCodec {
        return Content_Task_JsonCodec.instance
    }
}

export class Content_Task_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Task): unknown {
        if (this !== Content_Task_JsonCodec.lazyInstance.value) {
          return Content_Task_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "acceptance": Acceptance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.acceptance),
            "execution": Execution_JsonCodec.instance.encode(BaboonCodecContext.Default, value.execution),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Task {
        if (this !== Content_Task_JsonCodec .lazyInstance.value) {
            return Content_Task_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Task (
            obj["text"] as string,
            Acceptance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["acceptance"]),
            Execution_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["execution"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Task_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Task_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Task'
    public baboonTypeIdentifier() {
        return Content_Task_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Task_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Task_JsonCodec())
    public static get instance(): Content_Task_JsonCodec {
        return Content_Task_JsonCodec.lazyInstance.value
    }
}

export class Content_Statement implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Statement' as const;
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

    public with(overrides: {text?: string; modality?: Modality}): Content_Statement {
        return new Content_Statement(
            'text' in overrides ? overrides.text! : this._text,
            'modality' in overrides ? overrides.modality! : this._modality
        );
    }

    public static fromPlain(obj: {text: string; modality: Modality}): Content_Statement {
        return new Content_Statement(
            obj.text,
            obj.modality
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Statement.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Statement.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Statement'
    public baboonTypeIdentifier() {
        return Content_Statement.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Statement.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Statement.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Statement.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Statement.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Statement_JsonCodec {
        return Content_Statement_JsonCodec.instance
    }
}

export class Content_Statement_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Statement): unknown {
        if (this !== Content_Statement_JsonCodec.lazyInstance.value) {
          return Content_Statement_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "modality": Modality_JsonCodec.instance.encode(BaboonCodecContext.Default, value.modality),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Statement {
        if (this !== Content_Statement_JsonCodec .lazyInstance.value) {
            return Content_Statement_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Statement (
            obj["text"] as string,
            Modality_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["modality"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Statement_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Statement_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Statement'
    public baboonTypeIdentifier() {
        return Content_Statement_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Statement_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Statement_JsonCodec())
    public static get instance(): Content_Statement_JsonCodec {
        return Content_Statement_JsonCodec.lazyInstance.value
    }
}

export class Content_Hypothesis implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Hypothesis' as const;
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

    public with(overrides: {text?: string; prediction?: string}): Content_Hypothesis {
        return new Content_Hypothesis(
            'text' in overrides ? overrides.text! : this._text,
            'prediction' in overrides ? overrides.prediction! : this._prediction
        );
    }

    public static fromPlain(obj: {text: string; prediction: string}): Content_Hypothesis {
        return new Content_Hypothesis(
            obj.text,
            obj.prediction
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Hypothesis.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Hypothesis.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Hypothesis'
    public baboonTypeIdentifier() {
        return Content_Hypothesis.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Hypothesis.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Hypothesis.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Hypothesis.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Hypothesis.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Hypothesis_JsonCodec {
        return Content_Hypothesis_JsonCodec.instance
    }
}

export class Content_Hypothesis_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Hypothesis): unknown {
        if (this !== Content_Hypothesis_JsonCodec.lazyInstance.value) {
          return Content_Hypothesis_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "prediction": value.prediction,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Hypothesis {
        if (this !== Content_Hypothesis_JsonCodec .lazyInstance.value) {
            return Content_Hypothesis_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Hypothesis (
            obj["text"] as string,
            obj["prediction"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Hypothesis_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Hypothesis_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Hypothesis'
    public baboonTypeIdentifier() {
        return Content_Hypothesis_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Hypothesis_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Hypothesis_JsonCodec())
    public static get instance(): Content_Hypothesis_JsonCodec {
        return Content_Hypothesis_JsonCodec.lazyInstance.value
    }
}

export class Content_Defect implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Defect' as const;
    private readonly _text: string;
    private readonly _observed: string;
    private readonly _expected: string;
    private readonly _reproduction: string;
    private readonly _affected: Array<Ref>;
    private readonly _correction: Correction;

    constructor(text: string, observed: string, expected: string, reproduction: string, affected: Array<Ref>, correction: Correction) {
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
    public get affected(): Array<Ref> {
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

    public with(overrides: {text?: string; observed?: string; expected?: string; reproduction?: string; affected?: Array<Ref>; correction?: Correction}): Content_Defect {
        return new Content_Defect(
            'text' in overrides ? overrides.text! : this._text,
            'observed' in overrides ? overrides.observed! : this._observed,
            'expected' in overrides ? overrides.expected! : this._expected,
            'reproduction' in overrides ? overrides.reproduction! : this._reproduction,
            'affected' in overrides ? overrides.affected! : this._affected,
            'correction' in overrides ? overrides.correction! : this._correction
        );
    }

    public static fromPlain(obj: {text: string; observed: string; expected: string; reproduction: string; affected: Array<Ref>; correction: Correction}): Content_Defect {
        return new Content_Defect(
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
        return Content_Defect.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Defect.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Defect'
    public baboonTypeIdentifier() {
        return Content_Defect.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Defect.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Defect.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Defect.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Defect.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Defect_JsonCodec {
        return Content_Defect_JsonCodec.instance
    }
}

export class Content_Defect_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Defect): unknown {
        if (this !== Content_Defect_JsonCodec.lazyInstance.value) {
          return Content_Defect_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "observed": value.observed,
            "expected": value.expected,
            "reproduction": value.reproduction,
            "affected": Array.from(value.affected).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "correction": Correction_JsonCodec.instance.encode(BaboonCodecContext.Default, value.correction),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Defect {
        if (this !== Content_Defect_JsonCodec .lazyInstance.value) {
            return Content_Defect_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Defect (
            obj["text"] as string,
            obj["observed"] as string,
            obj["expected"] as string,
            obj["reproduction"] as string,
            (obj["affected"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            Correction_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["correction"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Defect_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Defect_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Defect'
    public baboonTypeIdentifier() {
        return Content_Defect_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Defect_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Defect_JsonCodec())
    public static get instance(): Content_Defect_JsonCodec {
        return Content_Defect_JsonCodec.lazyInstance.value
    }
}

export class Content_Question implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Question' as const;
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

    public with(overrides: {text?: string; alternatives?: Array<string>; answer?: string | undefined; escalation?: Escalation}): Content_Question {
        return new Content_Question(
            'text' in overrides ? overrides.text! : this._text,
            'alternatives' in overrides ? overrides.alternatives! : this._alternatives,
            'answer' in overrides ? overrides.answer! : this._answer,
            'escalation' in overrides ? overrides.escalation! : this._escalation
        );
    }

    public static fromPlain(obj: {text: string; alternatives: Array<string>; answer: string | undefined; escalation: Escalation}): Content_Question {
        return new Content_Question(
            obj.text,
            obj.alternatives,
            obj.answer,
            obj.escalation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Question.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Question.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Question'
    public baboonTypeIdentifier() {
        return Content_Question.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Question.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Question.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Question.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Question.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Question_JsonCodec {
        return Content_Question_JsonCodec.instance
    }
}

export class Content_Question_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Question): unknown {
        if (this !== Content_Question_JsonCodec.lazyInstance.value) {
          return Content_Question_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "alternatives": Array.from(value.alternatives),
            "answer": value.answer === undefined ? null : value.answer,
            "escalation": Escalation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.escalation),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Question {
        if (this !== Content_Question_JsonCodec .lazyInstance.value) {
            return Content_Question_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Question (
            obj["text"] as string,
            (obj["alternatives"] as unknown[]).map(item => item as string),
            obj["answer"] === undefined || obj["answer"] === null ? undefined : obj["answer"] === undefined || obj["answer"] === null ? undefined : obj["answer"] as string,
            Escalation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["escalation"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Question_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Question_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Question'
    public baboonTypeIdentifier() {
        return Content_Question_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Question_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Question_JsonCodec())
    public static get instance(): Content_Question_JsonCodec {
        return Content_Question_JsonCodec.lazyInstance.value
    }
}

export class Content_Decision implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Decision' as const;
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

    public with(overrides: {text?: string; alternatives?: Array<string>; rationale?: string}): Content_Decision {
        return new Content_Decision(
            'text' in overrides ? overrides.text! : this._text,
            'alternatives' in overrides ? overrides.alternatives! : this._alternatives,
            'rationale' in overrides ? overrides.rationale! : this._rationale
        );
    }

    public static fromPlain(obj: {text: string; alternatives: Array<string>; rationale: string}): Content_Decision {
        return new Content_Decision(
            obj.text,
            obj.alternatives,
            obj.rationale
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Decision.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Decision.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Decision'
    public baboonTypeIdentifier() {
        return Content_Decision.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Decision.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Decision.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Decision.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Decision.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Decision_JsonCodec {
        return Content_Decision_JsonCodec.instance
    }
}

export class Content_Decision_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Decision): unknown {
        if (this !== Content_Decision_JsonCodec.lazyInstance.value) {
          return Content_Decision_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "alternatives": Array.from(value.alternatives),
            "rationale": value.rationale,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Decision {
        if (this !== Content_Decision_JsonCodec .lazyInstance.value) {
            return Content_Decision_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Decision (
            obj["text"] as string,
            (obj["alternatives"] as unknown[]).map(item => item as string),
            obj["rationale"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Decision_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Decision_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Decision'
    public baboonTypeIdentifier() {
        return Content_Decision_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Decision_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Decision_JsonCodec())
    public static get instance(): Content_Decision_JsonCodec {
        return Content_Decision_JsonCodec.lazyInstance.value
    }
}

export class Content_Review implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Review' as const;
    private readonly _text: string;
    private readonly _findings: Array<string>;
    private readonly _subjects: Array<Ref>;
    private readonly _basis: Array<Ref>;
    private readonly _uncertainty: string;
    private readonly _assessment: Assessment;

    constructor(text: string, findings: Array<string>, subjects: Array<Ref>, basis: Array<Ref>, uncertainty: string, assessment: Assessment) {
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
    public get subjects(): Array<Ref> {
        return this._subjects;
    }
    public get basis(): Array<Ref> {
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

    public with(overrides: {text?: string; findings?: Array<string>; subjects?: Array<Ref>; basis?: Array<Ref>; uncertainty?: string; assessment?: Assessment}): Content_Review {
        return new Content_Review(
            'text' in overrides ? overrides.text! : this._text,
            'findings' in overrides ? overrides.findings! : this._findings,
            'subjects' in overrides ? overrides.subjects! : this._subjects,
            'basis' in overrides ? overrides.basis! : this._basis,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty,
            'assessment' in overrides ? overrides.assessment! : this._assessment
        );
    }

    public static fromPlain(obj: {text: string; findings: Array<string>; subjects: Array<Ref>; basis: Array<Ref>; uncertainty: string; assessment: Assessment}): Content_Review {
        return new Content_Review(
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
        return Content_Review.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Review.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Review'
    public baboonTypeIdentifier() {
        return Content_Review.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Review.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Review.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Review.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Review.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Review_JsonCodec {
        return Content_Review_JsonCodec.instance
    }
}

export class Content_Review_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Review): unknown {
        if (this !== Content_Review_JsonCodec.lazyInstance.value) {
          return Content_Review_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "findings": Array.from(value.findings),
            "subjects": Array.from(value.subjects).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "uncertainty": value.uncertainty,
            "assessment": Assessment_JsonCodec.instance.encode(BaboonCodecContext.Default, value.assessment),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Review {
        if (this !== Content_Review_JsonCodec .lazyInstance.value) {
            return Content_Review_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Review (
            obj["text"] as string,
            (obj["findings"] as unknown[]).map(item => item as string),
            (obj["subjects"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["uncertainty"] as string,
            Assessment_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["assessment"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Review_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Review_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Review'
    public baboonTypeIdentifier() {
        return Content_Review_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Review_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Review_JsonCodec())
    public static get instance(): Content_Review_JsonCodec {
        return Content_Review_JsonCodec.lazyInstance.value
    }
}

export class Content_Source implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Source' as const;
    private readonly _text: string;
    private readonly _context: Array<Ref>;
    private readonly _rawDigest: string;
    private readonly _eventId: string;

    constructor(text: string, context: Array<Ref>, rawDigest: string, eventId: string) {
        this._text = text
        this._context = context
        this._rawDigest = rawDigest
        this._eventId = eventId
    }

    public get text(): string {
        return this._text;
    }
    public get context(): Array<Ref> {
        return this._context;
    }
    public get rawDigest(): string {
        return this._rawDigest;
    }
    public get eventId(): string {
        return this._eventId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            context: this._context,
            rawDigest: this._rawDigest,
            eventId: this._eventId
        };
    }

    public with(overrides: {text?: string; context?: Array<Ref>; rawDigest?: string; eventId?: string}): Content_Source {
        return new Content_Source(
            'text' in overrides ? overrides.text! : this._text,
            'context' in overrides ? overrides.context! : this._context,
            'rawDigest' in overrides ? overrides.rawDigest! : this._rawDigest,
            'eventId' in overrides ? overrides.eventId! : this._eventId
        );
    }

    public static fromPlain(obj: {text: string; context: Array<Ref>; rawDigest: string; eventId: string}): Content_Source {
        return new Content_Source(
            obj.text,
            obj.context,
            obj.rawDigest,
            obj.eventId
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Source.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Source.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Source'
    public baboonTypeIdentifier() {
        return Content_Source.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Source.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Source.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Source.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Source.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Source_JsonCodec {
        return Content_Source_JsonCodec.instance
    }
}

export class Content_Source_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Source): unknown {
        if (this !== Content_Source_JsonCodec.lazyInstance.value) {
          return Content_Source_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "context": Array.from(value.context).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "rawDigest": value.rawDigest,
            "eventId": value.eventId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Source {
        if (this !== Content_Source_JsonCodec .lazyInstance.value) {
            return Content_Source_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Source (
            obj["text"] as string,
            (obj["context"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["rawDigest"] as string,
            obj["eventId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Source_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Source_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Source'
    public baboonTypeIdentifier() {
        return Content_Source_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Source_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Source_JsonCodec())
    public static get instance(): Content_Source_JsonCodec {
        return Content_Source_JsonCodec.lazyInstance.value
    }
}

export class Content_Artifact implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Artifact' as const;
    private readonly _text: string;
    private readonly _digest: string;
    private readonly _mediaType: string;
    private readonly _locator: string;
    private readonly _generation: bigint;

    constructor(text: string, digest: string, mediaType: string, locator: string, generation: bigint) {
        this._text = text
        this._digest = digest
        this._mediaType = mediaType
        this._locator = locator
        this._generation = generation
    }

    public get text(): string {
        return this._text;
    }
    public get digest(): string {
        return this._digest;
    }
    public get mediaType(): string {
        return this._mediaType;
    }
    public get locator(): string {
        return this._locator;
    }
    public get generation(): bigint {
        return this._generation;
    }

    public toJSON(): Record<string, unknown> {
        return {
            text: this._text,
            digest: this._digest,
            mediaType: this._mediaType,
            locator: this._locator,
            generation: this._generation
        };
    }

    public with(overrides: {text?: string; digest?: string; mediaType?: string; locator?: string; generation?: bigint}): Content_Artifact {
        return new Content_Artifact(
            'text' in overrides ? overrides.text! : this._text,
            'digest' in overrides ? overrides.digest! : this._digest,
            'mediaType' in overrides ? overrides.mediaType! : this._mediaType,
            'locator' in overrides ? overrides.locator! : this._locator,
            'generation' in overrides ? overrides.generation! : this._generation
        );
    }

    public static fromPlain(obj: {text: string; digest: string; mediaType: string; locator: string; generation: bigint}): Content_Artifact {
        return new Content_Artifact(
            obj.text,
            obj.digest,
            obj.mediaType,
            obj.locator,
            obj.generation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Artifact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Artifact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Artifact'
    public baboonTypeIdentifier() {
        return Content_Artifact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Artifact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Artifact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Artifact.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Artifact.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Artifact_JsonCodec {
        return Content_Artifact_JsonCodec.instance
    }
}

export class Content_Artifact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Artifact): unknown {
        if (this !== Content_Artifact_JsonCodec.lazyInstance.value) {
          return Content_Artifact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "digest": value.digest,
            "mediaType": value.mediaType,
            "locator": value.locator,
            "generation": value.generation.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Artifact {
        if (this !== Content_Artifact_JsonCodec .lazyInstance.value) {
            return Content_Artifact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Artifact (
            obj["text"] as string,
            obj["digest"] as string,
            obj["mediaType"] as string,
            obj["locator"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Artifact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Artifact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Artifact'
    public baboonTypeIdentifier() {
        return Content_Artifact_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Artifact_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Artifact_JsonCodec())
    public static get instance(): Content_Artifact_JsonCodec {
        return Content_Artifact_JsonCodec.lazyInstance.value
    }
}

export class Content_Conflict implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Content]#Conflict' as const;
    private readonly _text: string;
    private readonly _subjects: Array<Ref>;
    private readonly _status: ConflictState;
    private readonly _resolution: string | undefined;
    private readonly _uncertainty: string;

    constructor(text: string, subjects: Array<Ref>, status: ConflictState, resolution: string | undefined, uncertainty: string) {
        this._text = text
        this._subjects = subjects
        this._status = status
        this._resolution = resolution
        this._uncertainty = uncertainty
    }

    public get text(): string {
        return this._text;
    }
    public get subjects(): Array<Ref> {
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

    public with(overrides: {text?: string; subjects?: Array<Ref>; status?: ConflictState; resolution?: string | undefined; uncertainty?: string}): Content_Conflict {
        return new Content_Conflict(
            'text' in overrides ? overrides.text! : this._text,
            'subjects' in overrides ? overrides.subjects! : this._subjects,
            'status' in overrides ? overrides.status! : this._status,
            'resolution' in overrides ? overrides.resolution! : this._resolution,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty
        );
    }

    public static fromPlain(obj: {text: string; subjects: Array<Ref>; status: ConflictState; resolution: string | undefined; uncertainty: string}): Content_Conflict {
        return new Content_Conflict(
            obj.text,
            obj.subjects,
            obj.status,
            obj.resolution,
            obj.uncertainty
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Conflict.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Conflict.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Conflict'
    public baboonTypeIdentifier() {
        return Content_Conflict.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Content_Conflict.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Content_Conflict.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Content_Conflict.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Conflict.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Content_Conflict_JsonCodec {
        return Content_Conflict_JsonCodec.instance
    }
}

export class Content_Conflict_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content_Conflict): unknown {
        if (this !== Content_Conflict_JsonCodec.lazyInstance.value) {
          return Content_Conflict_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "text": value.text,
            "subjects": Array.from(value.subjects).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "status": ConflictState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.status),
            "resolution": value.resolution === undefined ? null : value.resolution,
            "uncertainty": value.uncertainty,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content_Conflict {
        if (this !== Content_Conflict_JsonCodec .lazyInstance.value) {
            return Content_Conflict_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Content_Conflict (
            obj["text"] as string,
            (obj["subjects"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            ConflictState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["status"]),
            obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] as string,
            obj["uncertainty"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_Conflict_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_Conflict_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Content]#Conflict'
    public baboonTypeIdentifier() {
        return Content_Conflict_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_Conflict_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_Conflict_JsonCodec())
    public static get instance(): Content_Conflict_JsonCodec {
        return Content_Conflict_JsonCodec.lazyInstance.value
    }
}


export class Content_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Content): unknown {
        if (this !== Content_JsonCodec.lazyInstance.value) {
          return Content_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Content_Outcome) {
                return { "Outcome": Content_Outcome_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Constraint) {
                return { "Constraint": Content_Constraint_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Task) {
                return { "Task": Content_Task_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Statement) {
                return { "Statement": Content_Statement_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Hypothesis) {
                return { "Hypothesis": Content_Hypothesis_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Defect) {
                return { "Defect": Content_Defect_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Question) {
                return { "Question": Content_Question_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Decision) {
                return { "Decision": Content_Decision_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Review) {
                return { "Review": Content_Review_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Source) {
                return { "Source": Content_Source_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Artifact) {
                return { "Artifact": Content_Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Content_Conflict) {
                return { "Conflict": Content_Conflict_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Content {
        if (this !== Content_JsonCodec .lazyInstance.value) {
            return Content_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Outcome": return Content_Outcome_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Constraint": return Content_Constraint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Task": return Content_Task_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Statement": return Content_Statement_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Hypothesis": return Content_Hypothesis_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Defect": return Content_Defect_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Question": return Content_Question_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Decision": return Content_Decision_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Review": return Content_Review_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Source": return Content_Source_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Artifact": return Content_Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Conflict": return Content_Conflict_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Content_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Content_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Content'
    public baboonTypeIdentifier() {
        return Content_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Content'
    public baboonAdtTypeIdentifier() {
        return Content_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Content_JsonCodec())
    public static get instance(): Content_JsonCodec {
        return Content_JsonCodec.lazyInstance.value
    }
}