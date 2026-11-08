import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class UsersResult(
    items: List[UserInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UsersResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = UsersResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UsersResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UsersResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UsersResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UsersResult.baboonMinReaderVersions
  }
  
  object UsersResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#UsersResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UsersResult] = UsersResult_JsonCodec.instance
  }
  
  object UsersResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[UsersResult, BaboonJsonCodec[UsersResult]] {
    def encode(ctx: BaboonCodecContext, value: UsersResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => UserInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UsersResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(UserInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield UsersResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UsersResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UsersResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UsersResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UsersResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UsersResult]] = Lazy(UsersResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UsersResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UsersResult] = LazyInstance.value
  }
}