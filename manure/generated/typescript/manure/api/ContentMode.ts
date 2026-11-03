import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ContentMode {
    Subdomain = "Subdomain",
    Path = "Path"
}

export const ContentMode_values: ReadonlyArray<ContentMode> = [
    ContentMode.Subdomain,
    ContentMode.Path
] as const;

export function ContentMode_parse(s: string): ContentMode {
    const found = ContentMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ContentMode variant: " + s);
    }
    return found;
}

export class ContentMode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentMode): unknown {
        if (this !== ContentMode_JsonCodec.lazyInstance.value) {
          return ContentMode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentMode {
        if (this !== ContentMode_JsonCodec .lazyInstance.value) {
            return ContentMode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ContentMode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentMode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentMode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ContentMode'
    public baboonTypeIdentifier() {
        return ContentMode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentMode_JsonCodec())
    public static get instance(): ContentMode_JsonCodec {
        return ContentMode_JsonCodec.lazyInstance.value
    }
}