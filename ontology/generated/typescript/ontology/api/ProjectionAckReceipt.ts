import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionAckInput, ProjectionAckInput_JsonCodec} from './ProjectionAckInput.js'
import {ProjectionDisposition, ProjectionDisposition_JsonCodec} from './ProjectionDisposition.js'

export class ProjectionAckReceipt implements BaboonGeneratedLatest {
    private readonly _input: ProjectionAckInput;
    private readonly _disposition: ProjectionDisposition;
    private readonly _recordedAt: string;

    constructor(input: ProjectionAckInput, disposition: ProjectionDisposition, recordedAt: string) {
        this._input = input
        this._disposition = disposition
        this._recordedAt = recordedAt
    }

    public get input(): ProjectionAckInput {
        return this._input;
    }
    public get disposition(): ProjectionDisposition {
        return this._disposition;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            input: this._input,
            disposition: this._disposition,
            recordedAt: this._recordedAt
        };
    }

    public with(overrides: {input?: ProjectionAckInput; disposition?: ProjectionDisposition; recordedAt?: string}): ProjectionAckReceipt {
        return new ProjectionAckReceipt(
            'input' in overrides ? overrides.input! : this._input,
            'disposition' in overrides ? overrides.disposition! : this._disposition,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt
        );
    }

    public static fromPlain(obj: {input: ProjectionAckInput; disposition: ProjectionDisposition; recordedAt: string}): ProjectionAckReceipt {
        return new ProjectionAckReceipt(
            obj.input,
            obj.disposition,
            obj.recordedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionAckReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionAckReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionAckReceipt'
    public baboonTypeIdentifier() {
        return ProjectionAckReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionAckReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionAckReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionAckReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionAckReceipt_JsonCodec {
        return ProjectionAckReceipt_JsonCodec.instance
    }
}

export class ProjectionAckReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionAckReceipt): unknown {
        if (this !== ProjectionAckReceipt_JsonCodec.lazyInstance.value) {
          return ProjectionAckReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "input": ProjectionAckInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.input),
            "disposition": ProjectionDisposition_JsonCodec.instance.encode(BaboonCodecContext.Default, value.disposition),
            "recordedAt": value.recordedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionAckReceipt {
        if (this !== ProjectionAckReceipt_JsonCodec .lazyInstance.value) {
            return ProjectionAckReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionAckReceipt (
            ProjectionAckInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["input"]),
            ProjectionDisposition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["disposition"]),
            obj["recordedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionAckReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionAckReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionAckReceipt'
    public baboonTypeIdentifier() {
        return ProjectionAckReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionAckReceipt_JsonCodec())
    public static get instance(): ProjectionAckReceipt_JsonCodec {
        return ProjectionAckReceipt_JsonCodec.lazyInstance.value
    }
}