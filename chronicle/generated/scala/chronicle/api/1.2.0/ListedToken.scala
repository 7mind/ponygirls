import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
  final case class ListedToken(
    info: TokenInfo,
    source: TokenSource
  ) extends BaboonGenerated {
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
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ListedToken] = ListedToken_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
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