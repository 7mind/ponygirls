import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait Target extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Target.baboonDomainVersion
    override def baboonDomainIdentifier: String = Target.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Target.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Target.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Target.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Target.baboonMinReaderVersions
  }
  
  object Target {
    final case class Exact(
      ref: Ref
    ) extends Target with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Target.Exact.baboonDomainVersion
      override def baboonDomainIdentifier: String = Target.Exact.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Target.Exact.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Target.Exact.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Target.Exact.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Target.Exact.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Target.Exact.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Target.Exact.baboonAdtType
    }
    
    object Exact {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Target]#Exact"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Target"
      def baboonAdtType: _root_.java.lang.Class[?] = Target.getClass
      def codecJson: BaboonJsonCodec[Target.Exact] = Target.Exact_JsonCodec.instance
    }
    
    object Exact_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Target.Exact, BaboonJsonCodec[Target.Exact]] {
      def encode(ctx: BaboonCodecContext, value: Target.Exact): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Target.Exact] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield Target.Exact(ref)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Exact: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Target.Exact.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Target.Exact.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Target.Exact.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Target.Exact.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Target.Exact.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Target.Exact]] = Lazy(Target.Exact_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Target.Exact]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Target.Exact] = LazyInstance.value
    }
    
    
    final case class Created(
      alias: String
    ) extends Target with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Target.Created.baboonDomainVersion
      override def baboonDomainIdentifier: String = Target.Created.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Target.Created.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Target.Created.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Target.Created.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Target.Created.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Target.Created.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Target.Created.baboonAdtType
    }
    
    object Created {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Target]#Created"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Target"
      def baboonAdtType: _root_.java.lang.Class[?] = Target.getClass
      def codecJson: BaboonJsonCodec[Target.Created] = Target.Created_JsonCodec.instance
    }
    
    object Created_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Target.Created, BaboonJsonCodec[Target.Created]] {
      def encode(ctx: BaboonCodecContext, value: Target.Created): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Target.Created] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
            } yield Target.Created(alias)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Created: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Target.Created.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Target.Created.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Target.Created.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Target.Created.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Target.Created.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Target.Created]] = Lazy(Target.Created_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Target.Created]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Target.Created] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Target"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Target] = Target_JsonCodec.instance
  }
  
  object Target_JsonCodec extends BaboonJsonCodec.BaseGenerated[Target, BaboonJsonCodec[Target]] {
    def encode(ctx: BaboonCodecContext, value: Target): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case exact: Target.Exact => Json.obj("Exact" -> Target.Exact_JsonCodec.instance.encode(ctx, exact))
        
        case created: Target.Created => Json.obj("Created" -> Target.Created_JsonCodec.instance.encode(ctx, created))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Target] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Exact" =>
                  Target.Exact_JsonCodec.instance.decode(ctx, json)
                
                case "Created" =>
                  Target.Created_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Target: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Target: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Target: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Target.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Target.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Target.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Target]] = Lazy(Target_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Target]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Target] = LazyInstance.value
  }
}