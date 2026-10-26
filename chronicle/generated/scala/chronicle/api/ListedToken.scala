import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ListedToken(
    info: TokenInfo,
    source: TokenSource
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ListedToken.baboonDomainVersion
    override def baboonDomainIdentifier: String = ListedToken.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ListedToken.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ListedToken.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ListedToken.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ListedToken.baboonMinReaderVersions
  }
  
  object ListedToken {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ListedToken"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ListedToken] = ListedToken_JsonCodec.instance
  }
  
  object ListedToken_JsonCodec extends BaboonJsonCodec.BaseGenerated[ListedToken, BaboonJsonCodec[ListedToken]] {
    def encode(ctx: BaboonCodecContext, value: ListedToken): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "info" -> TokenInfo_JsonCodec.instance.encode(ctx, value.info),
        "source" -> TokenSource_JsonCodec.instance.encode(ctx, value.source)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ListedToken] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            info <- getField(jsonObject, "info").flatMap(v => TokenInfo_JsonCodec.circeDecoder(v.hcursor))
            source <- getField(jsonObject, "source").flatMap(v => TokenSource_JsonCodec.circeDecoder(v.hcursor))
          } yield ListedToken(info,source)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ListedToken: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ListedToken.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ListedToken.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ListedToken.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ListedToken]] = Lazy(ListedToken_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ListedToken]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ListedToken] = LazyInstance.value
  }
}