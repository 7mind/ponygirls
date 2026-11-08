

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Artifact, Artifact_JsonCodec } from './Artifact.js';
import { ArtifactKind, ArtifactKind_JsonCodec } from './ArtifactKind.js';
import { ArtifactPatch, ArtifactPatch_JsonCodec } from './ArtifactPatch.js';
import { ArtifactState, ArtifactState_JsonCodec } from './ArtifactState.js';
import { ByteRange, ByteRange_JsonCodec } from './ByteRange.js';
import { Capabilities, Capabilities_JsonCodec } from './Capabilities.js';
import { CataloguePage, CataloguePage_JsonCodec } from './CataloguePage.js';
import { CatalogueQuery, CatalogueQuery_JsonCodec } from './CatalogueQuery.js';
import { CatalogueSort, CatalogueSort_JsonCodec } from './CatalogueSort.js';
import { ChunkReceipt, ChunkReceipt_JsonCodec } from './ChunkReceipt.js';
import { ClientEnvelope, ClientEnvelope_JsonCodec } from './ClientEnvelope.js';
import { Command, Command_JsonCodec } from './Command.js';
import { ContentCommand, ContentCommand_JsonCodec } from './ContentCommand.js';
import { ContentEnvelope, ContentEnvelope_JsonCodec } from './ContentEnvelope.js';
import { ContentMode, ContentMode_JsonCodec } from './ContentMode.js';
import { ErrorCode, ErrorCode_JsonCodec } from './ErrorCode.js';
import { EvidenceField, EvidenceField_JsonCodec } from './EvidenceField.js';
import { ExpiryChange, ExpiryChange_JsonCodec } from './ExpiryChange.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { FileProgress, FileProgress_JsonCodec } from './FileProgress.js';
import { Manifest, Manifest_JsonCodec } from './Manifest.js';
import { ManifestEntry, ManifestEntry_JsonCodec } from './ManifestEntry.js';
import { Principal, Principal_JsonCodec } from './Principal.js';
import { PrincipalType, PrincipalType_JsonCodec } from './PrincipalType.js';
import { Result, Result_JsonCodec } from './Result.js';
import { SearchCountScope, SearchCountScope_JsonCodec } from './SearchCountScope.js';
import { SearchEvidence, SearchEvidence_JsonCodec } from './SearchEvidence.js';
import { SearchFilter, SearchFilter_JsonCodec } from './SearchFilter.js';
import { SearchHit, SearchHit_JsonCodec } from './SearchHit.js';
import { SearchMode, SearchMode_JsonCodec } from './SearchMode.js';
import { SearchPage, SearchPage_JsonCodec } from './SearchPage.js';
import { SearchQuery, SearchQuery_JsonCodec } from './SearchQuery.js';
import { ServerEnvelope, ServerEnvelope_JsonCodec } from './ServerEnvelope.js';
import { SortDirection, SortDirection_JsonCodec } from './SortDirection.js';
import { UploadStatus, UploadStatus_JsonCodec } from './UploadStatus.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';
import { Visibility, Visibility_JsonCodec } from './Visibility.js';

class DomainManureApiV1_0_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(Artifact_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Artifact_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArtifactKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArtifactKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArtifactPatch_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArtifactPatch_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArtifactState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArtifactState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ByteRange_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ByteRange_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Capabilities_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Capabilities_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CataloguePage_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CataloguePage_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CatalogueQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CatalogueQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CatalogueSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CatalogueSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunkReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Command_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Command_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentCommand_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentCommand_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ErrorCode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ErrorCode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(EvidenceField_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => EvidenceField_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpiryChange_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpiryChange_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FileProgress_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FileProgress_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Manifest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Manifest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ManifestEntry_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ManifestEntry_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Principal_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Principal_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PrincipalType_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PrincipalType_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Result_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Result_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchEvidence_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchEvidence_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilter_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilter_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHit_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchPage_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchPage_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirection_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirection_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UploadStatus_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UploadStatus_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Visibility_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Visibility_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainManureApiV1_0_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainManureApiV1_0_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.0.0'; }
}

class DomainManureApiV1_0_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "manure.api/:#Artifact": ['1.0.0'],
        "manure.api/:#ArtifactKind": ['1.0.0'],
        "manure.api/:#ArtifactPatch": ['1.0.0'],
        "manure.api/:#ArtifactState": ['1.0.0'],
        "manure.api/:#ByteRange": ['1.0.0'],
        "manure.api/:#Capabilities": ['1.0.0'],
        "manure.api/:#CataloguePage": ['1.0.0'],
        "manure.api/:#CatalogueQuery": ['1.0.0'],
        "manure.api/:#CatalogueSort": ['1.0.0'],
        "manure.api/:#ChunkReceipt": ['1.0.0'],
        "manure.api/:#ClientEnvelope": ['1.0.0'],
        "manure.api/:#Command": ['1.0.0'],
        "manure.api/:#ContentCommand": ['1.0.0'],
        "manure.api/:#ContentEnvelope": ['1.0.0'],
        "manure.api/:#ContentMode": ['1.0.0'],
        "manure.api/:#ErrorCode": ['1.0.0'],
        "manure.api/:#EvidenceField": ['1.0.0'],
        "manure.api/:#ExpiryChange": ['1.0.0'],
        "manure.api/:#Failure": ['1.0.0'],
        "manure.api/:#FileProgress": ['1.0.0'],
        "manure.api/:#Manifest": ['1.0.0'],
        "manure.api/:#ManifestEntry": ['1.0.0'],
        "manure.api/:#Principal": ['1.0.0'],
        "manure.api/:#PrincipalType": ['1.0.0'],
        "manure.api/:#Result": ['1.0.0'],
        "manure.api/:#SearchCountScope": ['1.0.0'],
        "manure.api/:#SearchEvidence": ['1.0.0'],
        "manure.api/:#SearchFilter": ['1.0.0'],
        "manure.api/:#SearchHit": ['1.0.0'],
        "manure.api/:#SearchMode": ['1.0.0'],
        "manure.api/:#SearchPage": ['1.0.0'],
        "manure.api/:#SearchQuery": ['1.0.0'],
        "manure.api/:#ServerEnvelope": ['1.0.0'],
        "manure.api/:#SortDirection": ['1.0.0'],
        "manure.api/:#UploadStatus": ['1.0.0'],
        "manure.api/:#VersionInfo": ['1.0.0'],
        "manure.api/:#Visibility": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#CreateGrant": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#DeleteArtifact": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#FinishUpload": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#GetArtifact": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#GetCapabilities": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#GetExternalPassword": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#GetManifest": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#GetUploadStatus": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#InitUpload": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#ListArtifacts": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#Login": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#Logout": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#PatchArtifact": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#RotateExternalPassword": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#Search": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#Version": ['1.0.0'],
        "manure.api/[manure.api/:#Command]#Whoami": ['1.0.0'],
        "manure.api/[manure.api/:#ContentCommand]#GetManifest": ['1.0.0'],
        "manure.api/[manure.api/:#ContentCommand]#Logout": ['1.0.0'],
        "manure.api/[manure.api/:#ContentCommand]#RedeemGrant": ['1.0.0'],
        "manure.api/[manure.api/:#ContentCommand]#Unlock": ['1.0.0'],
        "manure.api/[manure.api/:#ExpiryChange]#Clear": ['1.0.0'],
        "manure.api/[manure.api/:#ExpiryChange]#Keep": ['1.0.0'],
        "manure.api/[manure.api/:#ExpiryChange]#Set": ['1.0.0'],
        "manure.api/[manure.api/:#ManifestEntry]#Directory": ['1.0.0'],
        "manure.api/[manure.api/:#ManifestEntry]#File": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#ArtifactInfo": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#ArtifactManifest": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#ArtifactPatched": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#CapabilityInfo": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#Catalogue": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#Error": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#GrantCreated": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#Identity": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#Ok": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#PasswordRotated": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#SearchResults": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#UploadFinished": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#UploadInitialized": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#UploadProgress": ['1.0.0'],
        "manure.api/[manure.api/:#Result]#Version": ['1.0.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "manure.api/:#Artifact": { '1.0.0': 'identical' },
        "manure.api/:#ArtifactKind": { '1.0.0': 'identical' },
        "manure.api/:#ArtifactPatch": { '1.0.0': 'identical' },
        "manure.api/:#ArtifactState": { '1.0.0': 'identical' },
        "manure.api/:#ByteRange": { '1.0.0': 'identical' },
        "manure.api/:#Capabilities": { '1.0.0': 'identical' },
        "manure.api/:#CataloguePage": { '1.0.0': 'identical' },
        "manure.api/:#CatalogueQuery": { '1.0.0': 'identical' },
        "manure.api/:#CatalogueSort": { '1.0.0': 'identical' },
        "manure.api/:#ChunkReceipt": { '1.0.0': 'identical' },
        "manure.api/:#ClientEnvelope": { '1.0.0': 'identical' },
        "manure.api/:#Command": { '1.0.0': 'identical' },
        "manure.api/:#ContentCommand": { '1.0.0': 'identical' },
        "manure.api/:#ContentEnvelope": { '1.0.0': 'identical' },
        "manure.api/:#ContentMode": { '1.0.0': 'identical' },
        "manure.api/:#ErrorCode": { '1.0.0': 'identical' },
        "manure.api/:#EvidenceField": { '1.0.0': 'identical' },
        "manure.api/:#ExpiryChange": { '1.0.0': 'identical' },
        "manure.api/:#Failure": { '1.0.0': 'identical' },
        "manure.api/:#FileProgress": { '1.0.0': 'identical' },
        "manure.api/:#Manifest": { '1.0.0': 'identical' },
        "manure.api/:#ManifestEntry": { '1.0.0': 'identical' },
        "manure.api/:#Principal": { '1.0.0': 'identical' },
        "manure.api/:#PrincipalType": { '1.0.0': 'identical' },
        "manure.api/:#Result": { '1.0.0': 'identical' },
        "manure.api/:#SearchCountScope": { '1.0.0': 'identical' },
        "manure.api/:#SearchEvidence": { '1.0.0': 'identical' },
        "manure.api/:#SearchFilter": { '1.0.0': 'identical' },
        "manure.api/:#SearchHit": { '1.0.0': 'identical' },
        "manure.api/:#SearchMode": { '1.0.0': 'identical' },
        "manure.api/:#SearchPage": { '1.0.0': 'identical' },
        "manure.api/:#SearchQuery": { '1.0.0': 'identical' },
        "manure.api/:#ServerEnvelope": { '1.0.0': 'identical' },
        "manure.api/:#SortDirection": { '1.0.0': 'identical' },
        "manure.api/:#UploadStatus": { '1.0.0': 'identical' },
        "manure.api/:#VersionInfo": { '1.0.0': 'identical' },
        "manure.api/:#Visibility": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#CreateGrant": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#DeleteArtifact": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#FinishUpload": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#GetArtifact": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#GetCapabilities": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#GetExternalPassword": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#GetManifest": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#GetUploadStatus": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#InitUpload": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#ListArtifacts": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#Login": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#Logout": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#PatchArtifact": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#RotateExternalPassword": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#Search": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#Version": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Command]#Whoami": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ContentCommand]#GetManifest": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ContentCommand]#Logout": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ContentCommand]#RedeemGrant": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ContentCommand]#Unlock": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ExpiryChange]#Clear": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ExpiryChange]#Keep": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ExpiryChange]#Set": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ManifestEntry]#Directory": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#ManifestEntry]#File": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#ArtifactInfo": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#ArtifactManifest": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#ArtifactPatched": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#CapabilityInfo": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#Catalogue": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#Error": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#GrantCreated": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#Identity": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#Ok": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#PasswordRotated": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#SearchResults": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#UploadFinished": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#UploadInitialized": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#UploadProgress": { '1.0.0': 'identical' },
        "manure.api/[manure.api/:#Result]#Version": { '1.0.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainManureApiV1_0_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainManureApiV1_0_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainManureApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('manure.api', '1.0.0'),
            () => new DomainManureApiV1_0_0JsonCodecs(),
            () => new DomainManureApiV1_0_0UebaCodecs(),
            () => new DomainManureApiV1_0_0Conversions(),
            () => new DomainManureApiV1_0_0Meta(),
        );
    }
}