import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait PresentedSelectionInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentedSelectionInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentedSelectionInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentedSelectionInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentedSelectionInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentedSelectionInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentedSelectionInput.baboonMinReaderVersions
  }
  
  object PresentedSelectionInput {
    final case class Whole(
      target: Target
    ) extends PresentedSelectionInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = PresentedSelectionInput.Whole.baboonDomainVersion
      override def baboonDomainIdentifier: String = PresentedSelectionInput.Whole.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = PresentedSelectionInput.Whole.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = PresentedSelectionInput.Whole.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = PresentedSelectionInput.Whole.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = PresentedSelectionInput.Whole.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = PresentedSelectionInput.Whole.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.Whole.baboonAdtType
    }
    
    object Whole {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#PresentedSelectionInput]#Whole"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#PresentedSelectionInput"
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.getClass
      def codecJson: BaboonJsonCodec[PresentedSelectionInput.Whole] = PresentedSelectionInput.Whole_JsonCodec.instance
    }
    
    object Whole_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[PresentedSelectionInput.Whole, BaboonJsonCodec[PresentedSelectionInput.Whole]] {
      def encode(ctx: BaboonCodecContext, value: PresentedSelectionInput.Whole): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "target" -> Target_JsonCodec.instance.encode(ctx, value.target)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelectionInput.Whole] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              target <- getField(jsonObject, "target").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
            } yield PresentedSelectionInput.Whole(target)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Whole: object expected"))
        }
      }
    
      def baboonDomainVersion: String = PresentedSelectionInput.Whole.baboonDomainVersion
      
      def baboonDomainIdentifier: String = PresentedSelectionInput.Whole.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = PresentedSelectionInput.Whole.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = PresentedSelectionInput.Whole.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.Whole.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput.Whole]] = Lazy(PresentedSelectionInput.Whole_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput.Whole]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[PresentedSelectionInput.Whole] = LazyInstance.value
    }
    
    
    final case class Alternative(
      target: Target,
      definition: Target,
      index: Int,
      label: String
    ) extends PresentedSelectionInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = PresentedSelectionInput.Alternative.baboonDomainVersion
      override def baboonDomainIdentifier: String = PresentedSelectionInput.Alternative.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = PresentedSelectionInput.Alternative.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = PresentedSelectionInput.Alternative.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = PresentedSelectionInput.Alternative.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = PresentedSelectionInput.Alternative.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = PresentedSelectionInput.Alternative.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.Alternative.baboonAdtType
    }
    
    object Alternative {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#PresentedSelectionInput]#Alternative"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#PresentedSelectionInput"
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.getClass
      def codecJson: BaboonJsonCodec[PresentedSelectionInput.Alternative] = PresentedSelectionInput.Alternative_JsonCodec.instance
    }
    
    object Alternative_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[PresentedSelectionInput.Alternative, BaboonJsonCodec[PresentedSelectionInput.Alternative]] {
      def encode(ctx: BaboonCodecContext, value: PresentedSelectionInput.Alternative): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "target" -> Target_JsonCodec.instance.encode(ctx, value.target),
          "definition" -> Target_JsonCodec.instance.encode(ctx, value.definition),
          "index" -> Json.fromInt(value.index),
          "label" -> Json.fromString(value.label)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelectionInput.Alternative] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              target <- getField(jsonObject, "target").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              definition <- getField(jsonObject, "definition").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              index <- getField(jsonObject, "index").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              label <- getField(jsonObject, "label").flatMap(v => decodeString(v.hcursor))
            } yield PresentedSelectionInput.Alternative(target,definition,index,label)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Alternative: object expected"))
        }
      }
    
      def baboonDomainVersion: String = PresentedSelectionInput.Alternative.baboonDomainVersion
      
      def baboonDomainIdentifier: String = PresentedSelectionInput.Alternative.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = PresentedSelectionInput.Alternative.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = PresentedSelectionInput.Alternative.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelectionInput.Alternative.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput.Alternative]] = Lazy(PresentedSelectionInput.Alternative_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput.Alternative]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[PresentedSelectionInput.Alternative] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentedSelectionInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentedSelectionInput] = PresentedSelectionInput_JsonCodec.instance
  }
  
  object PresentedSelectionInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentedSelectionInput, BaboonJsonCodec[PresentedSelectionInput]] {
    def encode(ctx: BaboonCodecContext, value: PresentedSelectionInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case whole: PresentedSelectionInput.Whole => Json.obj("Whole" -> PresentedSelectionInput.Whole_JsonCodec.instance.encode(ctx, whole))
        
        case alternative: PresentedSelectionInput.Alternative => Json.obj("Alternative" -> PresentedSelectionInput.Alternative_JsonCodec.instance.encode(ctx, alternative))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelectionInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Whole" =>
                  PresentedSelectionInput.Whole_JsonCodec.instance.decode(ctx, json)
                
                case "Alternative" =>
                  PresentedSelectionInput.Alternative_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelectionInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelectionInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelectionInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentedSelectionInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentedSelectionInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentedSelectionInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput]] = Lazy(PresentedSelectionInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelectionInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentedSelectionInput] = LazyInstance.value
  }
}