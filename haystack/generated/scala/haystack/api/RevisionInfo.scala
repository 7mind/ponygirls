import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class RevisionInfo(
    revision: Int,
    modifiedAt: String,
    modifiedBy: String,
    tokenId: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RevisionInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = RevisionInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RevisionInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RevisionInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RevisionInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RevisionInfo.baboonMinReaderVersions
  }
  
  object RevisionInfo {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#RevisionInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RevisionInfo] = RevisionInfo_JsonCodec.instance
  }
  
  object RevisionInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[RevisionInfo, BaboonJsonCodec[RevisionInfo]] {
    def encode(ctx: BaboonCodecContext, value: RevisionInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "revision" -> Json.fromInt(value.revision),
        "modifiedAt" -> Json.fromString(value.modifiedAt),
        "modifiedBy" -> Json.fromString(value.modifiedBy),
        "tokenId" -> Json.fromString(value.tokenId)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RevisionInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            modifiedAt <- getField(jsonObject, "modifiedAt").flatMap(v => decodeString(v.hcursor))
            modifiedBy <- getField(jsonObject, "modifiedBy").flatMap(v => decodeString(v.hcursor))
            tokenId <- getField(jsonObject, "tokenId").flatMap(v => decodeString(v.hcursor))
          } yield RevisionInfo(revision,modifiedAt,modifiedBy,tokenId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RevisionInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RevisionInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RevisionInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RevisionInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RevisionInfo]] = Lazy(RevisionInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RevisionInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RevisionInfo] = LazyInstance.value
  }
}