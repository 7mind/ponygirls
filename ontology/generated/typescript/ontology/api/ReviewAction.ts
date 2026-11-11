import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {JudgmentKind, JudgmentKind_JsonCodec} from './JudgmentKind.js'
import {PresentedSelection, PresentedSelection_JsonCodec} from './PresentedSelection.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type ReviewAction = ReviewAction_Review | ReviewAction_Choose | ReviewAction_Adopt

export const ReviewAction = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#ReviewAction',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#ReviewAction',
    jsonCodec(): ReviewAction_JsonCodec {
        return ReviewAction_JsonCodec.instance
    }
} as const

export class ReviewAction_Review implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ReviewAction]#Review' as const;
    private readonly _kind: JudgmentKind;

    constructor(kind: JudgmentKind) {
        this._kind = kind
    }

    public get kind(): JudgmentKind {
        return this._kind;
    }

    public toJSON(): Record<string, unknown> {
        return {
            kind: this._kind
        };
    }

    public with(overrides: {kind?: JudgmentKind}): ReviewAction_Review {
        return new ReviewAction_Review(
            'kind' in overrides ? overrides.kind! : this._kind
        );
    }

    public static fromPlain(obj: {kind: JudgmentKind}): ReviewAction_Review {
        return new ReviewAction_Review(
            obj.kind
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Review.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Review.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Review'
    public baboonTypeIdentifier() {
        return ReviewAction_Review.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReviewAction_Review.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReviewAction_Review.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReviewAction_Review.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Review.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ReviewAction_Review_JsonCodec {
        return ReviewAction_Review_JsonCodec.instance
    }
}

export class ReviewAction_Review_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReviewAction_Review): unknown {
        if (this !== ReviewAction_Review_JsonCodec.lazyInstance.value) {
          return ReviewAction_Review_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "kind": JudgmentKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReviewAction_Review {
        if (this !== ReviewAction_Review_JsonCodec .lazyInstance.value) {
            return ReviewAction_Review_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReviewAction_Review (
            JudgmentKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Review_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Review_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Review'
    public baboonTypeIdentifier() {
        return ReviewAction_Review_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Review_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReviewAction_Review_JsonCodec())
    public static get instance(): ReviewAction_Review_JsonCodec {
        return ReviewAction_Review_JsonCodec.lazyInstance.value
    }
}

export class ReviewAction_Choose implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ReviewAction]#Choose' as const;
    private readonly _selection: PresentedSelection;

    constructor(selection: PresentedSelection) {
        this._selection = selection
    }

    public get selection(): PresentedSelection {
        return this._selection;
    }

    public toJSON(): Record<string, unknown> {
        return {
            selection: this._selection
        };
    }

    public with(overrides: {selection?: PresentedSelection}): ReviewAction_Choose {
        return new ReviewAction_Choose(
            'selection' in overrides ? overrides.selection! : this._selection
        );
    }

    public static fromPlain(obj: {selection: PresentedSelection}): ReviewAction_Choose {
        return new ReviewAction_Choose(
            obj.selection
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Choose.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Choose.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Choose'
    public baboonTypeIdentifier() {
        return ReviewAction_Choose.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReviewAction_Choose.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReviewAction_Choose.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReviewAction_Choose.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Choose.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ReviewAction_Choose_JsonCodec {
        return ReviewAction_Choose_JsonCodec.instance
    }
}

export class ReviewAction_Choose_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReviewAction_Choose): unknown {
        if (this !== ReviewAction_Choose_JsonCodec.lazyInstance.value) {
          return ReviewAction_Choose_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "selection": PresentedSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.selection),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReviewAction_Choose {
        if (this !== ReviewAction_Choose_JsonCodec .lazyInstance.value) {
            return ReviewAction_Choose_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReviewAction_Choose (
            PresentedSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["selection"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Choose_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Choose_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Choose'
    public baboonTypeIdentifier() {
        return ReviewAction_Choose_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Choose_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReviewAction_Choose_JsonCodec())
    public static get instance(): ReviewAction_Choose_JsonCodec {
        return ReviewAction_Choose_JsonCodec.lazyInstance.value
    }
}

export class ReviewAction_Adopt implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ReviewAction]#Adopt' as const;
    private readonly _target: Ref;

    constructor(target: Ref) {
        this._target = target
    }

    public get target(): Ref {
        return this._target;
    }

    public toJSON(): Record<string, unknown> {
        return {
            target: this._target
        };
    }

    public with(overrides: {target?: Ref}): ReviewAction_Adopt {
        return new ReviewAction_Adopt(
            'target' in overrides ? overrides.target! : this._target
        );
    }

    public static fromPlain(obj: {target: Ref}): ReviewAction_Adopt {
        return new ReviewAction_Adopt(
            obj.target
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Adopt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Adopt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Adopt'
    public baboonTypeIdentifier() {
        return ReviewAction_Adopt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReviewAction_Adopt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReviewAction_Adopt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReviewAction_Adopt.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Adopt.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ReviewAction_Adopt_JsonCodec {
        return ReviewAction_Adopt_JsonCodec.instance
    }
}

export class ReviewAction_Adopt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReviewAction_Adopt): unknown {
        if (this !== ReviewAction_Adopt_JsonCodec.lazyInstance.value) {
          return ReviewAction_Adopt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReviewAction_Adopt {
        if (this !== ReviewAction_Adopt_JsonCodec .lazyInstance.value) {
            return ReviewAction_Adopt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReviewAction_Adopt (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_Adopt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_Adopt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ReviewAction]#Adopt'
    public baboonTypeIdentifier() {
        return ReviewAction_Adopt_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_Adopt_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReviewAction_Adopt_JsonCodec())
    public static get instance(): ReviewAction_Adopt_JsonCodec {
        return ReviewAction_Adopt_JsonCodec.lazyInstance.value
    }
}


export class ReviewAction_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReviewAction): unknown {
        if (this !== ReviewAction_JsonCodec.lazyInstance.value) {
          return ReviewAction_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ReviewAction_Review) {
                return { "Review": ReviewAction_Review_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ReviewAction_Choose) {
                return { "Choose": ReviewAction_Choose_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ReviewAction_Adopt) {
                return { "Adopt": ReviewAction_Adopt_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReviewAction {
        if (this !== ReviewAction_JsonCodec .lazyInstance.value) {
            return ReviewAction_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Review": return ReviewAction_Review_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Choose": return ReviewAction_Choose_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Adopt": return ReviewAction_Adopt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReviewAction_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReviewAction_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonTypeIdentifier() {
        return ReviewAction_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ReviewAction'
    public baboonAdtTypeIdentifier() {
        return ReviewAction_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReviewAction_JsonCodec())
    public static get instance(): ReviewAction_JsonCodec {
        return ReviewAction_JsonCodec.lazyInstance.value
    }
}