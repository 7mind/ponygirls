import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum JudgmentKind {
    Accept = "Accept",
    RequestCorrection = "RequestCorrection",
    NeedEvidence = "NeedEvidence",
    ReviseIntent = "ReviseIntent"
}

export const JudgmentKind_values: ReadonlyArray<JudgmentKind> = [
    JudgmentKind.Accept,
    JudgmentKind.RequestCorrection,
    JudgmentKind.NeedEvidence,
    JudgmentKind.ReviseIntent
] as const;

export function JudgmentKind_parse(s: string): JudgmentKind {
    const found = JudgmentKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown JudgmentKind variant: " + s);
    }
    return found;
}

export class JudgmentKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JudgmentKind): unknown {
        if (this !== JudgmentKind_JsonCodec.lazyInstance.value) {
          return JudgmentKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JudgmentKind {
        if (this !== JudgmentKind_JsonCodec .lazyInstance.value) {
            return JudgmentKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return JudgmentKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return JudgmentKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return JudgmentKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#JudgmentKind'
    public baboonTypeIdentifier() {
        return JudgmentKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JudgmentKind_JsonCodec())
    public static get instance(): JudgmentKind_JsonCodec {
        return JudgmentKind_JsonCodec.lazyInstance.value
    }
}