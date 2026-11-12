import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait Applicability extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Applicability.baboonDomainVersion
    override def baboonDomainIdentifier: String = Applicability.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Applicability.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Applicability.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Applicability.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Applicability.baboonMinReaderVersions
  }
  
  object Applicability {
    final case class Unresolved(
      reason: String,
      basis: List[Ref],
      context: List[ApplicabilityContext]
    ) extends Applicability with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Applicability.Unresolved.baboonDomainVersion
      override def baboonDomainIdentifier: String = Applicability.Unresolved.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Applicability.Unresolved.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Applicability.Unresolved.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Applicability.Unresolved.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Applicability.Unresolved.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Applicability.Unresolved.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Unresolved.baboonAdtType
    }
    
    object Unresolved {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Applicability]#Unresolved"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Applicability"
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.getClass
      def codecJson: BaboonJsonCodec[Applicability.Unresolved] = Applicability.Unresolved_JsonCodec.instance
    }
    
    object Unresolved_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Applicability.Unresolved, BaboonJsonCodec[Applicability.Unresolved]] {
      def encode(ctx: BaboonCodecContext, value: Applicability.Unresolved): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "reason" -> Json.fromString(value.reason),
          "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "context" -> Json.fromValues(value.context.map(e => ApplicabilityContext_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Applicability.Unresolved] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(ApplicabilityContext_JsonCodec.circeDecoder)(v.hcursor))
            } yield Applicability.Unresolved(reason,basis,context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Unresolved: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Applicability.Unresolved.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Applicability.Unresolved.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Applicability.Unresolved.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Applicability.Unresolved.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Unresolved.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Applicability.Unresolved]] = Lazy(Applicability.Unresolved_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Applicability.Unresolved]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Applicability.Unresolved] = LazyInstance.value
    }
    
    
    final case class Declared(
      statement: String,
      basis: List[Ref],
      context: List[ApplicabilityContext]
    ) extends Applicability with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Applicability.Declared.baboonDomainVersion
      override def baboonDomainIdentifier: String = Applicability.Declared.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Applicability.Declared.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Applicability.Declared.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Applicability.Declared.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Applicability.Declared.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Applicability.Declared.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Declared.baboonAdtType
    }
    
    object Declared {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Applicability]#Declared"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Applicability"
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.getClass
      def codecJson: BaboonJsonCodec[Applicability.Declared] = Applicability.Declared_JsonCodec.instance
    }
    
    object Declared_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Applicability.Declared, BaboonJsonCodec[Applicability.Declared]] {
      def encode(ctx: BaboonCodecContext, value: Applicability.Declared): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "statement" -> Json.fromString(value.statement),
          "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "context" -> Json.fromValues(value.context.map(e => ApplicabilityContext_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Applicability.Declared] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              statement <- getField(jsonObject, "statement").flatMap(v => decodeString(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(ApplicabilityContext_JsonCodec.circeDecoder)(v.hcursor))
            } yield Applicability.Declared(statement,basis,context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Declared: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Applicability.Declared.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Applicability.Declared.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Applicability.Declared.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Applicability.Declared.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Declared.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Applicability.Declared]] = Lazy(Applicability.Declared_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Applicability.Declared]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Applicability.Declared] = LazyInstance.value
    }
    
    
    final case class Captured(
      source: Ref
    ) extends Applicability with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Applicability.Captured.baboonDomainVersion
      override def baboonDomainIdentifier: String = Applicability.Captured.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Applicability.Captured.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Applicability.Captured.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Applicability.Captured.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Applicability.Captured.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Applicability.Captured.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Captured.baboonAdtType
    }
    
    object Captured {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Applicability]#Captured"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Applicability"
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.getClass
      def codecJson: BaboonJsonCodec[Applicability.Captured] = Applicability.Captured_JsonCodec.instance
    }
    
    object Captured_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Applicability.Captured, BaboonJsonCodec[Applicability.Captured]] {
      def encode(ctx: BaboonCodecContext, value: Applicability.Captured): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "source" -> Ref_JsonCodec.instance.encode(ctx, value.source)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Applicability.Captured] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield Applicability.Captured(source)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Captured: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Applicability.Captured.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Applicability.Captured.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Applicability.Captured.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Applicability.Captured.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Applicability.Captured.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Applicability.Captured]] = Lazy(Applicability.Captured_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Applicability.Captured]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Applicability.Captured] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Applicability"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Applicability] = Applicability_JsonCodec.instance
  }
  
  object Applicability_JsonCodec extends BaboonJsonCodec.BaseGenerated[Applicability, BaboonJsonCodec[Applicability]] {
    def encode(ctx: BaboonCodecContext, value: Applicability): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case unresolved: Applicability.Unresolved => Json.obj("Unresolved" -> Applicability.Unresolved_JsonCodec.instance.encode(ctx, unresolved))
        
        case declared: Applicability.Declared => Json.obj("Declared" -> Applicability.Declared_JsonCodec.instance.encode(ctx, declared))
        
        case captured: Applicability.Captured => Json.obj("Captured" -> Applicability.Captured_JsonCodec.instance.encode(ctx, captured))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Applicability] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Unresolved" =>
                  Applicability.Unresolved_JsonCodec.instance.decode(ctx, json)
                
                case "Declared" =>
                  Applicability.Declared_JsonCodec.instance.decode(ctx, json)
                
                case "Captured" =>
                  Applicability.Captured_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Applicability: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Applicability: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Applicability: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Applicability.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Applicability.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Applicability.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Applicability]] = Lazy(Applicability_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Applicability]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Applicability] = LazyInstance.value
  }
}