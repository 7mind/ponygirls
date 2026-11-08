import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RepositoriesResult(
    items: List[RepositoryInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RepositoriesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RepositoriesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RepositoriesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RepositoriesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RepositoriesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RepositoriesResult.baboonMinReaderVersions
  }
  
  object RepositoriesResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RepositoriesResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RepositoriesResult] = RepositoriesResult_JsonCodec.instance
  }
  
  object RepositoriesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RepositoriesResult, BaboonJsonCodec[RepositoriesResult]] {
    def encode(ctx: BaboonCodecContext, value: RepositoriesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => RepositoryInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RepositoriesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(RepositoryInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield RepositoriesResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RepositoriesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RepositoriesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RepositoriesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RepositoriesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RepositoriesResult]] = Lazy(RepositoriesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RepositoriesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RepositoriesResult] = LazyInstance.value
  }
}