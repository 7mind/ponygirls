import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class Item(
    key: String,
    revision: Int,
    document: DocumentPayload,
    metadata: Metadata
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Item.baboonDomainVersion
    override def baboonDomainIdentifier: String = Item.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Item.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Item.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Item.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Item.baboonMinReaderVersions
  }
  
  object Item {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#Item"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Item] = Item_JsonCodec.instance
  }
  
  object Item_JsonCodec extends BaboonJsonCodec.BaseGenerated[Item, BaboonJsonCodec[Item]] {
    def encode(ctx: BaboonCodecContext, value: Item): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "revision" -> Json.fromInt(value.revision),
        "document" -> DocumentPayload_JsonCodec.instance.encode(ctx, value.document),
        "metadata" -> Metadata_JsonCodec.instance.encode(ctx, value.metadata)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Item] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            document <- getField(jsonObject, "document").flatMap(v => DocumentPayload_JsonCodec.circeDecoder(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => Metadata_JsonCodec.circeDecoder(v.hcursor))
          } yield Item(key,revision,document,metadata)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Item: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Item.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Item.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Item.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Item]] = Lazy(Item_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Item]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Item] = LazyInstance.value
  }
}