import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait ApplicabilityInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ApplicabilityInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = ApplicabilityInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ApplicabilityInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ApplicabilityInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ApplicabilityInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ApplicabilityInput.baboonMinReaderVersions
  }
  
  object ApplicabilityInput {
    final case class Unresolved(
      reason: String,
      basis: List[Target],
      context: List[ApplicabilityContextInput]
    ) extends ApplicabilityInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityInput.Unresolved.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityInput.Unresolved.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityInput.Unresolved.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityInput.Unresolved.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityInput.Unresolved.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityInput.Unresolved.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityInput.Unresolved.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.Unresolved.baboonAdtType
    }
    
    object Unresolved {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityInput.Unresolved] = ApplicabilityInput.Unresolved_JsonCodec.instance
    }
    
    object Unresolved_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityInput.Unresolved, BaboonJsonCodec[ApplicabilityInput.Unresolved]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityInput.Unresolved): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "reason" -> Json.fromString(value.reason),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "context" -> Json.fromValues(value.context.map(e => ApplicabilityContextInput_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityInput.Unresolved] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(ApplicabilityContextInput_JsonCodec.circeDecoder)(v.hcursor))
            } yield ApplicabilityInput.Unresolved(reason,basis,context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Unresolved: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityInput.Unresolved.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityInput.Unresolved.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityInput.Unresolved.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityInput.Unresolved.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.Unresolved.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput.Unresolved]] = Lazy(ApplicabilityInput.Unresolved_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput.Unresolved]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityInput.Unresolved] = LazyInstance.value
    }
    
    
    final case class Declared(
      statement: String,
      basis: List[Target],
      context: List[ApplicabilityContextInput]
    ) extends ApplicabilityInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityInput.Declared.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityInput.Declared.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityInput.Declared.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityInput.Declared.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityInput.Declared.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityInput.Declared.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityInput.Declared.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.Declared.baboonAdtType
    }
    
    object Declared {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityInput]#Declared"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityInput.Declared] = ApplicabilityInput.Declared_JsonCodec.instance
    }
    
    object Declared_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityInput.Declared, BaboonJsonCodec[ApplicabilityInput.Declared]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityInput.Declared): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "statement" -> Json.fromString(value.statement),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "context" -> Json.fromValues(value.context.map(e => ApplicabilityContextInput_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityInput.Declared] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              statement <- getField(jsonObject, "statement").flatMap(v => decodeString(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(ApplicabilityContextInput_JsonCodec.circeDecoder)(v.hcursor))
            } yield ApplicabilityInput.Declared(statement,basis,context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Declared: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityInput.Declared.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityInput.Declared.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityInput.Declared.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityInput.Declared.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityInput.Declared.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput.Declared]] = Lazy(ApplicabilityInput.Declared_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput.Declared]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityInput.Declared] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ApplicabilityInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ApplicabilityInput] = ApplicabilityInput_JsonCodec.instance
  }
  
  object ApplicabilityInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[ApplicabilityInput, BaboonJsonCodec[ApplicabilityInput]] {
    def encode(ctx: BaboonCodecContext, value: ApplicabilityInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case unresolved: ApplicabilityInput.Unresolved => Json.obj("Unresolved" -> ApplicabilityInput.Unresolved_JsonCodec.instance.encode(ctx, unresolved))
        
        case declared: ApplicabilityInput.Declared => Json.obj("Declared" -> ApplicabilityInput.Declared_JsonCodec.instance.encode(ctx, declared))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Unresolved" =>
                  ApplicabilityInput.Unresolved_JsonCodec.instance.decode(ctx, json)
                
                case "Declared" =>
                  ApplicabilityInput.Declared_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ApplicabilityInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ApplicabilityInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ApplicabilityInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput]] = Lazy(ApplicabilityInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ApplicabilityInput] = LazyInstance.value
  }
}