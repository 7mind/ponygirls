import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ArchiveSort {
    LastTimestamp = "LastTimestamp",
    Title = "Title",
    Owner = "Owner",
    Project = "Project",
    Branch = "Branch",
    Producer = "Producer",
    Format = "Format",
    Model = "Model",
    Status = "Status",
    MessageCount = "MessageCount",
    Tags = "Tags"
}

export const ArchiveSort_values: ReadonlyArray<ArchiveSort> = [
    ArchiveSort.LastTimestamp,
    ArchiveSort.Title,
    ArchiveSort.Owner,
    ArchiveSort.Project,
    ArchiveSort.Branch,
    ArchiveSort.Producer,
    ArchiveSort.Format,
    ArchiveSort.Model,
    ArchiveSort.Status,
    ArchiveSort.MessageCount,
    ArchiveSort.Tags
] as const;

export function ArchiveSort_parse(s: string): ArchiveSort {
    const found = ArchiveSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArchiveSort variant: " + s);
    }
    return found;
}

export class ArchiveSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveSort): unknown {
        if (this !== ArchiveSort_JsonCodec.lazyInstance.value) {
          return ArchiveSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveSort {
        if (this !== ArchiveSort_JsonCodec .lazyInstance.value) {
            return ArchiveSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ArchiveSort_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return ArchiveSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSort'
    public baboonTypeIdentifier() {
        return ArchiveSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveSort_JsonCodec())
    public static get instance(): ArchiveSort_JsonCodec {
        return ArchiveSort_JsonCodec.lazyInstance.value
    }
}