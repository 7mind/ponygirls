import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package manure.api {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "1.0.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("manure.api/:#ExpiryChange", Lazy(ExpiryChange_JsonCodec))
    register("manure.api/:#ContentCommand", Lazy(ContentCommand_JsonCodec))
    register("manure.api/:#ChunkReceipt", Lazy(ChunkReceipt_JsonCodec))
    register("manure.api/:#SearchHit", Lazy(SearchHit_JsonCodec))
    register("manure.api/:#ByteRange", Lazy(ByteRange_JsonCodec))
    register("manure.api/:#SearchEvidence", Lazy(SearchEvidence_JsonCodec))
    register("manure.api/:#SortDirection", Lazy(SortDirection_JsonCodec))
    register("manure.api/:#Command", Lazy(Command_JsonCodec))
    register("manure.api/:#Principal", Lazy(Principal_JsonCodec))
    register("manure.api/:#FileProgress", Lazy(FileProgress_JsonCodec))
    register("manure.api/:#Manifest", Lazy(Manifest_JsonCodec))
    register("manure.api/:#ContentEnvelope", Lazy(ContentEnvelope_JsonCodec))
    register("manure.api/:#CatalogueSort", Lazy(CatalogueSort_JsonCodec))
    register("manure.api/:#Artifact", Lazy(Artifact_JsonCodec))
    register("manure.api/:#SearchFilter", Lazy(SearchFilter_JsonCodec))
    register("manure.api/:#ArtifactPatch", Lazy(ArtifactPatch_JsonCodec))
    register("manure.api/:#ErrorCode", Lazy(ErrorCode_JsonCodec))
    register("manure.api/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("manure.api/:#CataloguePage", Lazy(CataloguePage_JsonCodec))
    register("manure.api/:#SearchMode", Lazy(SearchMode_JsonCodec))
    register("manure.api/:#ManifestEntry", Lazy(ManifestEntry_JsonCodec))
    register("manure.api/:#EvidenceField", Lazy(EvidenceField_JsonCodec))
    register("manure.api/:#ArtifactKind", Lazy(ArtifactKind_JsonCodec))
    register("manure.api/:#ContentMode", Lazy(ContentMode_JsonCodec))
    register("manure.api/:#Failure", Lazy(Failure_JsonCodec))
    register("manure.api/:#SearchPage", Lazy(SearchPage_JsonCodec))
    register("manure.api/:#ClientEnvelope", Lazy(ClientEnvelope_JsonCodec))
    register("manure.api/:#Capabilities", Lazy(Capabilities_JsonCodec))
    register("manure.api/:#UploadStatus", Lazy(UploadStatus_JsonCodec))
    register("manure.api/:#PrincipalType", Lazy(PrincipalType_JsonCodec))
    register("manure.api/:#SearchQuery", Lazy(SearchQuery_JsonCodec))
    register("manure.api/:#Result", Lazy(Result_JsonCodec))
    register("manure.api/:#Visibility", Lazy(Visibility_JsonCodec))
    register("manure.api/:#ServerEnvelope", Lazy(ServerEnvelope_JsonCodec))
    register("manure.api/:#CatalogueQuery", Lazy(CatalogueQuery_JsonCodec))
    register("manure.api/:#ArtifactState", Lazy(ArtifactState_JsonCodec))
    register("manure.api/:#SearchCountScope", Lazy(SearchCountScope_JsonCodec))
  }
}