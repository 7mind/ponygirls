import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ReadView {
    Current = "Current",
    History = "History",
    BindingContext = "BindingContext"
}

export const ReadView_values: ReadonlyArray<ReadView> = [
    ReadView.Current,
    ReadView.History,
    ReadView.BindingContext
] as const;

export function ReadView_parse(s: string): ReadView {
    const found = ReadView_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ReadView variant: " + s);
    }
    return found;
}

export class ReadView_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReadView): unknown {
        if (this !== ReadView_JsonCodec.lazyInstance.value) {
          return ReadView_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReadView {
        if (this !== ReadView_JsonCodec .lazyInstance.value) {
            return ReadView_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ReadView_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReadView_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReadView_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReadView'
    public baboonTypeIdentifier() {
        return ReadView_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReadView_JsonCodec())
    public static get instance(): ReadView_JsonCodec {
        return ReadView_JsonCodec.lazyInstance.value
    }
}