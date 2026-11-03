import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class SearchSort(
    field: String,
    direction: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchSort.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchSort.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchSort.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchSort.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchSort.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchSort.baboonMinReaderVersions
  }
  
  object SearchSort {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#SearchSort"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchSort] = SearchSort_JsonCodec.instance
  }
  
  object SearchSort_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchSort, BaboonJsonCodec[SearchSort]] {
    def encode(ctx: BaboonCodecContext, value: SearchSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "field" -> Json.fromString(value.field),
        "direction" -> Json.fromString(value.direction)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            field <- getField(jsonObject, "field").flatMap(v => decodeString(v.hcursor))
            direction <- getField(jsonObject, "direction").flatMap(v => decodeString(v.hcursor))
          } yield SearchSort(field,direction)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchSort: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchSort.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchSort.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchSort.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchSort]] = Lazy(SearchSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchSort] = LazyInstance.value
  }
}