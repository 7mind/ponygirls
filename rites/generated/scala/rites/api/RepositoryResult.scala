import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RepositoryResult(
    repository: RepositoryInfo
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RepositoryResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RepositoryResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RepositoryResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RepositoryResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RepositoryResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RepositoryResult.baboonMinReaderVersions
  }
  
  object RepositoryResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RepositoryResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RepositoryResult] = RepositoryResult_JsonCodec.instance
  }
  
  object RepositoryResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RepositoryResult, BaboonJsonCodec[RepositoryResult]] {
    def encode(ctx: BaboonCodecContext, value: RepositoryResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repository" -> RepositoryInfo_JsonCodec.instance.encode(ctx, value.repository)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RepositoryResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repository <- getField(jsonObject, "repository").flatMap(v => RepositoryInfo_JsonCodec.circeDecoder(v.hcursor))
          } yield RepositoryResult(repository)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RepositoryResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RepositoryResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RepositoryResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RepositoryResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RepositoryResult]] = Lazy(RepositoryResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RepositoryResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RepositoryResult] = LazyInstance.value
  }
}