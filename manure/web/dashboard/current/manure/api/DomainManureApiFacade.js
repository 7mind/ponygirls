import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonDomainVersion, Lazy } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Artifact_JsonCodec } from './Artifact.js';
import { ArtifactKind_JsonCodec } from './ArtifactKind.js';
import { ArtifactPatch_JsonCodec } from './ArtifactPatch.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { ByteRange_JsonCodec } from './ByteRange.js';
import { Capabilities_JsonCodec } from './Capabilities.js';
import { CataloguePage_JsonCodec } from './CataloguePage.js';
import { CatalogueQuery_JsonCodec } from './CatalogueQuery.js';
import { CatalogueSort_JsonCodec } from './CatalogueSort.js';
import { ChunkReceipt_JsonCodec } from './ChunkReceipt.js';
import { ClientEnvelope_JsonCodec } from './ClientEnvelope.js';
import { Command_JsonCodec } from './Command.js';
import { ContentCommand_JsonCodec } from './ContentCommand.js';
import { ContentEnvelope_JsonCodec } from './ContentEnvelope.js';
import { ContentMode_JsonCodec } from './ContentMode.js';
import { ErrorCode_JsonCodec } from './ErrorCode.js';
import { EvidenceField_JsonCodec } from './EvidenceField.js';
import { ExpiryChange_JsonCodec } from './ExpiryChange.js';
import { Failure_JsonCodec } from './Failure.js';
import { FileProgress_JsonCodec } from './FileProgress.js';
import { Manifest_JsonCodec } from './Manifest.js';
import { ManifestEntry_JsonCodec } from './ManifestEntry.js';
import { Principal_JsonCodec } from './Principal.js';
import { PrincipalType_JsonCodec } from './PrincipalType.js';
import { Result_JsonCodec } from './Result.js';
import { SearchCountScope_JsonCodec } from './SearchCountScope.js';
import { SearchEvidence_JsonCodec } from './SearchEvidence.js';
import { SearchFilter_JsonCodec } from './SearchFilter.js';
import { SearchHit_JsonCodec } from './SearchHit.js';
import { SearchMode_JsonCodec } from './SearchMode.js';
import { SearchPage_JsonCodec } from './SearchPage.js';
import { SearchQuery_JsonCodec } from './SearchQuery.js';
import { ServerEnvelope_JsonCodec } from './ServerEnvelope.js';
import { SortDirection_JsonCodec } from './SortDirection.js';
import { UploadStatus_JsonCodec } from './UploadStatus.js';
import { VersionInfo_JsonCodec } from './VersionInfo.js';
import { Visibility_JsonCodec } from './Visibility.js';
class DomainManureApiV1_0_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(Artifact_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Artifact_JsonCodec.instance));
        this.register(ArtifactKind_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ArtifactKind_JsonCodec.instance));
        this.register(ArtifactPatch_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ArtifactPatch_JsonCodec.instance));
        this.register(ArtifactState_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ArtifactState_JsonCodec.instance));
        this.register(ByteRange_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ByteRange_JsonCodec.instance));
        this.register(Capabilities_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Capabilities_JsonCodec.instance));
        this.register(CataloguePage_JsonCodec.BaboonTypeIdentifier, new Lazy(() => CataloguePage_JsonCodec.instance));
        this.register(CatalogueQuery_JsonCodec.BaboonTypeIdentifier, new Lazy(() => CatalogueQuery_JsonCodec.instance));
        this.register(CatalogueSort_JsonCodec.BaboonTypeIdentifier, new Lazy(() => CatalogueSort_JsonCodec.instance));
        this.register(ChunkReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ChunkReceipt_JsonCodec.instance));
        this.register(ClientEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ClientEnvelope_JsonCodec.instance));
        this.register(Command_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Command_JsonCodec.instance));
        this.register(ContentCommand_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ContentCommand_JsonCodec.instance));
        this.register(ContentEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ContentEnvelope_JsonCodec.instance));
        this.register(ContentMode_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ContentMode_JsonCodec.instance));
        this.register(ErrorCode_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ErrorCode_JsonCodec.instance));
        this.register(EvidenceField_JsonCodec.BaboonTypeIdentifier, new Lazy(() => EvidenceField_JsonCodec.instance));
        this.register(ExpiryChange_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ExpiryChange_JsonCodec.instance));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Failure_JsonCodec.instance));
        this.register(FileProgress_JsonCodec.BaboonTypeIdentifier, new Lazy(() => FileProgress_JsonCodec.instance));
        this.register(Manifest_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Manifest_JsonCodec.instance));
        this.register(ManifestEntry_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ManifestEntry_JsonCodec.instance));
        this.register(Principal_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Principal_JsonCodec.instance));
        this.register(PrincipalType_JsonCodec.BaboonTypeIdentifier, new Lazy(() => PrincipalType_JsonCodec.instance));
        this.register(Result_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Result_JsonCodec.instance));
        this.register(SearchCountScope_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchCountScope_JsonCodec.instance));
        this.register(SearchEvidence_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchEvidence_JsonCodec.instance));
        this.register(SearchFilter_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchFilter_JsonCodec.instance));
        this.register(SearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchHit_JsonCodec.instance));
        this.register(SearchMode_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchMode_JsonCodec.instance));
        this.register(SearchPage_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchPage_JsonCodec.instance));
        this.register(SearchQuery_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SearchQuery_JsonCodec.instance));
        this.register(ServerEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy(() => ServerEnvelope_JsonCodec.instance));
        this.register(SortDirection_JsonCodec.BaboonTypeIdentifier, new Lazy(() => SortDirection_JsonCodec.instance));
        this.register(UploadStatus_JsonCodec.BaboonTypeIdentifier, new Lazy(() => UploadStatus_JsonCodec.instance));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy(() => VersionInfo_JsonCodec.instance));
        this.register(Visibility_JsonCodec.BaboonTypeIdentifier, new Lazy(() => Visibility_JsonCodec.instance));
    }
}
class DomainManureApiV1_0_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
    }
}
class DomainManureApiV1_0_0Conversions {
    versionsFrom() { return []; }
    versionTo() { return '1.0.0'; }
}
class DomainManureApiV1_0_0Meta {
    static SAME_IN = {
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
    static FORWARD = {
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
    sameInVersions(typeId) { return [...(DomainManureApiV1_0_0Meta.SAME_IN[typeId] ?? [])]; }
    forwardReadableVersions(typeId) { return DomainManureApiV1_0_0Meta.FORWARD[typeId] ?? {}; }
}
export class DomainManureApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(new BaboonDomainVersion('manure.api', '1.0.0'), () => new DomainManureApiV1_0_0JsonCodecs(), () => new DomainManureApiV1_0_0UebaCodecs(), () => new DomainManureApiV1_0_0Conversions(), () => new DomainManureApiV1_0_0Meta());
    }
}
