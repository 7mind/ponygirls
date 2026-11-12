import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum SourceRepresentation {
    Text = "Text",
    PiTranscript = "PiTranscript",
    HostReceipt = "HostReceipt",
    GraphCommand = "GraphCommand",
    HumanJudgment = "HumanJudgment"
}

export const SourceRepresentation_values: ReadonlyArray<SourceRepresentation> = [
    SourceRepresentation.Text,
    SourceRepresentation.PiTranscript,
    SourceRepresentation.HostReceipt,
    SourceRepresentation.GraphCommand,
    SourceRepresentation.HumanJudgment
] as const;

export function SourceRepresentation_parse(s: string): SourceRepresentation {
    const found = SourceRepresentation_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SourceRepresentation variant: " + s);
    }
    return found;
}

export class SourceRepresentation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceRepresentation): unknown {
        if (this !== SourceRepresentation_JsonCodec.lazyInstance.value) {
          return SourceRepresentation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceRepresentation {
        if (this !== SourceRepresentation_JsonCodec .lazyInstance.value) {
            return SourceRepresentation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return SourceRepresentation_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceRepresentation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceRepresentation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceRepresentation'
    public baboonTypeIdentifier() {
        return SourceRepresentation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceRepresentation_JsonCodec())
    public static get instance(): SourceRepresentation_JsonCodec {
        return SourceRepresentation_JsonCodec.lazyInstance.value
    }
}