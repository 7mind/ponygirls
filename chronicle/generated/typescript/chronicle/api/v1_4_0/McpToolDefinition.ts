import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class McpToolDefinition implements BaboonGenerated {
    private readonly _name: string;
    private readonly _description: string;
    private readonly _inputSchemaJson: string;

    constructor(name: string, description: string, inputSchemaJson: string) {
        this._name = name
        this._description = description
        this._inputSchemaJson = inputSchemaJson
    }

    public get name(): string {
        return this._name;
    }
    public get description(): string {
        return this._description;
    }
    public get inputSchemaJson(): string {
        return this._inputSchemaJson;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this._name,
            description: this._description,
            inputSchemaJson: this._inputSchemaJson
        };
    }

    public with(overrides: {name?: string; description?: string; inputSchemaJson?: string}): McpToolDefinition {
        return new McpToolDefinition(
            'name' in overrides ? overrides.name! : this._name,
            'description' in overrides ? overrides.description! : this._description,
            'inputSchemaJson' in overrides ? overrides.inputSchemaJson! : this._inputSchemaJson
        );
    }

    public static fromPlain(obj: {name: string; description: string; inputSchemaJson: string}): McpToolDefinition {
        return new McpToolDefinition(
            obj.name,
            obj.description,
            obj.inputSchemaJson
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return McpToolDefinition.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpToolDefinition.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpToolDefinition'
    public baboonTypeIdentifier() {
        return McpToolDefinition.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return McpToolDefinition.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return McpToolDefinition.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpToolDefinition.BaboonMinReaderVersions
    }
    public static jsonCodec(): McpToolDefinition_JsonCodec {
        return McpToolDefinition_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.7.0 */
export class McpToolDefinition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpToolDefinition): unknown {
        if (this !== McpToolDefinition_JsonCodec.lazyInstance.value) {
          return McpToolDefinition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "name": value.name,
            "description": value.description,
            "inputSchemaJson": value.inputSchemaJson,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpToolDefinition {
        if (this !== McpToolDefinition_JsonCodec .lazyInstance.value) {
            return McpToolDefinition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpToolDefinition (
            obj["name"] as string,
            obj["description"] as string,
            obj["inputSchemaJson"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return McpToolDefinition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpToolDefinition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpToolDefinition'
    public baboonTypeIdentifier() {
        return McpToolDefinition_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpToolDefinition_JsonCodec())
    public static get instance(): McpToolDefinition_JsonCodec {
        return McpToolDefinition_JsonCodec.lazyInstance.value
    }
}