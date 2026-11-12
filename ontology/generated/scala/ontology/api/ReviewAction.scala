
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  sealed trait ReviewAction extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReviewAction.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReviewAction.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReviewAction.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReviewAction.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReviewAction.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReviewAction.baboonMinReaderVersions
  }
  
  object ReviewAction {
    final case class Review(
      kind: JudgmentKind
    ) extends ReviewAction with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ReviewAction.Review.baboonDomainVersion
      override def baboonDomainIdentifier: String = ReviewAction.Review.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ReviewAction.Review.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ReviewAction.Review.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ReviewAction.Review.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ReviewAction.Review.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ReviewAction.Review.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Review.baboonAdtType
    }
    
    object Review {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ReviewAction]#Review"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ReviewAction"
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.getClass
      def codecJson: BaboonJsonCodec[ReviewAction.Review] = ReviewAction.Review_JsonCodec.instance
    }
    
    object Review_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ReviewAction.Review, BaboonJsonCodec[ReviewAction.Review]] {
      def encode(ctx: BaboonCodecContext, value: ReviewAction.Review): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "kind" -> JudgmentKind_JsonCodec.instance.encode(ctx, value.kind)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReviewAction.Review] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              kind <- getField(jsonObject, "kind").flatMap(v => JudgmentKind_JsonCodec.circeDecoder(v.hcursor))
            } yield ReviewAction.Review(kind)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Review: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ReviewAction.Review.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ReviewAction.Review.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ReviewAction.Review.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ReviewAction.Review.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Review.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Review]] = Lazy(ReviewAction.Review_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Review]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ReviewAction.Review] = LazyInstance.value
    }
    
    
    final case class Choose(
      selection: PresentedSelection
    ) extends ReviewAction with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ReviewAction.Choose.baboonDomainVersion
      override def baboonDomainIdentifier: String = ReviewAction.Choose.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ReviewAction.Choose.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ReviewAction.Choose.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ReviewAction.Choose.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ReviewAction.Choose.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ReviewAction.Choose.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Choose.baboonAdtType
    }
    
    object Choose {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ReviewAction]#Choose"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ReviewAction"
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.getClass
      def codecJson: BaboonJsonCodec[ReviewAction.Choose] = ReviewAction.Choose_JsonCodec.instance
    }
    
    object Choose_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ReviewAction.Choose, BaboonJsonCodec[ReviewAction.Choose]] {
      def encode(ctx: BaboonCodecContext, value: ReviewAction.Choose): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "selection" -> PresentedSelection_JsonCodec.instance.encode(ctx, value.selection)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReviewAction.Choose] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              selection <- getField(jsonObject, "selection").flatMap(v => PresentedSelection_JsonCodec.circeDecoder(v.hcursor))
            } yield ReviewAction.Choose(selection)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Choose: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ReviewAction.Choose.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ReviewAction.Choose.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ReviewAction.Choose.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ReviewAction.Choose.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Choose.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Choose]] = Lazy(ReviewAction.Choose_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Choose]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ReviewAction.Choose] = LazyInstance.value
    }
    
    
    final case class Adopt(
      target: Ref
    ) extends ReviewAction with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ReviewAction.Adopt.baboonDomainVersion
      override def baboonDomainIdentifier: String = ReviewAction.Adopt.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ReviewAction.Adopt.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ReviewAction.Adopt.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ReviewAction.Adopt.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ReviewAction.Adopt.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ReviewAction.Adopt.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Adopt.baboonAdtType
    }
    
    object Adopt {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ReviewAction]#Adopt"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ReviewAction"
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.getClass
      def codecJson: BaboonJsonCodec[ReviewAction.Adopt] = ReviewAction.Adopt_JsonCodec.instance
    }
    
    object Adopt_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ReviewAction.Adopt, BaboonJsonCodec[ReviewAction.Adopt]] {
      def encode(ctx: BaboonCodecContext, value: ReviewAction.Adopt): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "target" -> Ref_JsonCodec.instance.encode(ctx, value.target)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReviewAction.Adopt] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              target <- getField(jsonObject, "target").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield ReviewAction.Adopt(target)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Adopt: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ReviewAction.Adopt.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ReviewAction.Adopt.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ReviewAction.Adopt.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ReviewAction.Adopt.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ReviewAction.Adopt.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Adopt]] = Lazy(ReviewAction.Adopt_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ReviewAction.Adopt]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ReviewAction.Adopt] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReviewAction"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReviewAction] = ReviewAction_JsonCodec.instance
  }
  
  object ReviewAction_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReviewAction, BaboonJsonCodec[ReviewAction]] {
    def encode(ctx: BaboonCodecContext, value: ReviewAction): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case review: ReviewAction.Review => Json.obj("Review" -> ReviewAction.Review_JsonCodec.instance.encode(ctx, review))
        
        case choose: ReviewAction.Choose => Json.obj("Choose" -> ReviewAction.Choose_JsonCodec.instance.encode(ctx, choose))
        
        case adopt: ReviewAction.Adopt => Json.obj("Adopt" -> ReviewAction.Adopt_JsonCodec.instance.encode(ctx, adopt))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReviewAction] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Review" =>
                  ReviewAction.Review_JsonCodec.instance.decode(ctx, json)
                
                case "Choose" =>
                  ReviewAction.Choose_JsonCodec.instance.decode(ctx, json)
                
                case "Adopt" =>
                  ReviewAction.Adopt_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ReviewAction: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ReviewAction: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ReviewAction: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReviewAction.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReviewAction.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReviewAction.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReviewAction]] = Lazy(ReviewAction_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReviewAction]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReviewAction] = LazyInstance.value
  }
}