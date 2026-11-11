import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class InputReceipt(
    ref: Ref,
    scope: String,
    generation: Long,
    kind: InputKind,
    contributor: Actor,
    recorder: Actor,
    submitter: Actor,
    encoding: String,
    content: String,
    digest: String,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = InputReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = InputReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = InputReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = InputReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = InputReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = InputReceipt.baboonMinReaderVersions
  }
  
  object InputReceipt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#InputReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[InputReceipt] = InputReceipt_JsonCodec.instance
  }
  
  object InputReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[InputReceipt, BaboonJsonCodec[InputReceipt]] {
    def encode(ctx: BaboonCodecContext, value: InputReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "kind" -> InputKind_JsonCodec.instance.encode(ctx, value.kind),
        "contributor" -> Actor_JsonCodec.instance.encode(ctx, value.contributor),
        "recorder" -> Actor_JsonCodec.instance.encode(ctx, value.recorder),
        "submitter" -> Actor_JsonCodec.instance.encode(ctx, value.submitter),
        "encoding" -> Json.fromString(value.encoding),
        "content" -> Json.fromString(value.content),
        "digest" -> Json.fromString(value.digest),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InputReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => InputKind_JsonCodec.circeDecoder(v.hcursor))
            contributor <- getField(jsonObject, "contributor").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            recorder <- getField(jsonObject, "recorder").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            submitter <- getField(jsonObject, "submitter").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            encoding <- getField(jsonObject, "encoding").flatMap(v => decodeString(v.hcursor))
            content <- getField(jsonObject, "content").flatMap(v => decodeString(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield InputReceipt(ref,scope,generation,kind,contributor,recorder,submitter,encoding,content,digest,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to InputReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = InputReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = InputReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = InputReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InputReceipt]] = Lazy(InputReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[InputReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[InputReceipt] = LazyInstance.value
  }
}