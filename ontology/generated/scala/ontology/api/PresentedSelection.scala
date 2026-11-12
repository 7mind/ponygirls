import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait PresentedSelection extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentedSelection.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentedSelection.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentedSelection.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentedSelection.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentedSelection.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentedSelection.baboonMinReaderVersions
  }
  
  object PresentedSelection {
    final case class Whole(
      target: Ref
    ) extends PresentedSelection with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = PresentedSelection.Whole.baboonDomainVersion
      override def baboonDomainIdentifier: String = PresentedSelection.Whole.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = PresentedSelection.Whole.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = PresentedSelection.Whole.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = PresentedSelection.Whole.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = PresentedSelection.Whole.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = PresentedSelection.Whole.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.Whole.baboonAdtType
    }
    
    object Whole {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#PresentedSelection]#Whole"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#PresentedSelection"
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.getClass
      def codecJson: BaboonJsonCodec[PresentedSelection.Whole] = PresentedSelection.Whole_JsonCodec.instance
    }
    
    object Whole_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[PresentedSelection.Whole, BaboonJsonCodec[PresentedSelection.Whole]] {
      def encode(ctx: BaboonCodecContext, value: PresentedSelection.Whole): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "target" -> Ref_JsonCodec.instance.encode(ctx, value.target)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelection.Whole] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              target <- getField(jsonObject, "target").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield PresentedSelection.Whole(target)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Whole: object expected"))
        }
      }
    
      def baboonDomainVersion: String = PresentedSelection.Whole.baboonDomainVersion
      
      def baboonDomainIdentifier: String = PresentedSelection.Whole.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = PresentedSelection.Whole.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = PresentedSelection.Whole.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.Whole.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelection.Whole]] = Lazy(PresentedSelection.Whole_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelection.Whole]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[PresentedSelection.Whole] = LazyInstance.value
    }
    
    
    final case class Alternative(
      target: Ref,
      definition: Ref,
      index: Int,
      label: String
    ) extends PresentedSelection with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = PresentedSelection.Alternative.baboonDomainVersion
      override def baboonDomainIdentifier: String = PresentedSelection.Alternative.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = PresentedSelection.Alternative.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = PresentedSelection.Alternative.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = PresentedSelection.Alternative.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = PresentedSelection.Alternative.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = PresentedSelection.Alternative.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.Alternative.baboonAdtType
    }
    
    object Alternative {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#PresentedSelection]#Alternative"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#PresentedSelection"
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.getClass
      def codecJson: BaboonJsonCodec[PresentedSelection.Alternative] = PresentedSelection.Alternative_JsonCodec.instance
    }
    
    object Alternative_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[PresentedSelection.Alternative, BaboonJsonCodec[PresentedSelection.Alternative]] {
      def encode(ctx: BaboonCodecContext, value: PresentedSelection.Alternative): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "target" -> Ref_JsonCodec.instance.encode(ctx, value.target),
          "definition" -> Ref_JsonCodec.instance.encode(ctx, value.definition),
          "index" -> Json.fromInt(value.index),
          "label" -> Json.fromString(value.label)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelection.Alternative] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              target <- getField(jsonObject, "target").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              definition <- getField(jsonObject, "definition").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              index <- getField(jsonObject, "index").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              label <- getField(jsonObject, "label").flatMap(v => decodeString(v.hcursor))
            } yield PresentedSelection.Alternative(target,definition,index,label)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Alternative: object expected"))
        }
      }
    
      def baboonDomainVersion: String = PresentedSelection.Alternative.baboonDomainVersion
      
      def baboonDomainIdentifier: String = PresentedSelection.Alternative.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = PresentedSelection.Alternative.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = PresentedSelection.Alternative.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = PresentedSelection.Alternative.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelection.Alternative]] = Lazy(PresentedSelection.Alternative_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelection.Alternative]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[PresentedSelection.Alternative] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentedSelection"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentedSelection] = PresentedSelection_JsonCodec.instance
  }
  
  object PresentedSelection_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentedSelection, BaboonJsonCodec[PresentedSelection]] {
    def encode(ctx: BaboonCodecContext, value: PresentedSelection): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case whole: PresentedSelection.Whole => Json.obj("Whole" -> PresentedSelection.Whole_JsonCodec.instance.encode(ctx, whole))
        
        case alternative: PresentedSelection.Alternative => Json.obj("Alternative" -> PresentedSelection.Alternative_JsonCodec.instance.encode(ctx, alternative))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentedSelection] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Whole" =>
                  PresentedSelection.Whole_JsonCodec.instance.decode(ctx, json)
                
                case "Alternative" =>
                  PresentedSelection.Alternative_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelection: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelection: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to PresentedSelection: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentedSelection.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentedSelection.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentedSelection.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentedSelection]] = Lazy(PresentedSelection_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentedSelection]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentedSelection] = LazyInstance.value
  }
}