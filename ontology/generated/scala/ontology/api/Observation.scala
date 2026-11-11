import io.circe.Decoder.{decodeBoolean, decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait Observation extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Observation.baboonDomainVersion
    override def baboonDomainIdentifier: String = Observation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Observation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Observation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Observation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Observation.baboonMinReaderVersions
  }
  
  object Observation {
    final case class None(
      
    ) extends Observation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Observation.None.baboonDomainVersion
      override def baboonDomainIdentifier: String = Observation.None.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Observation.None.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Observation.None.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Observation.None.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Observation.None.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Observation.None.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Observation.None.baboonAdtType
    }
    
    object None {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Observation]#None"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Observation"
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.getClass
      def codecJson: BaboonJsonCodec[Observation.None] = Observation.None_JsonCodec.instance
    }
    
    object None_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Observation.None, BaboonJsonCodec[Observation.None]] {
      def encode(ctx: BaboonCodecContext, value: Observation.None): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Observation.None] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Observation.None())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to None: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Observation.None.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Observation.None.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Observation.None.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Observation.None.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.None.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Observation.None]] = Lazy(Observation.None_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Observation.None]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Observation.None] = LazyInstance.value
    }
    
    
    final case class FileVersion(
      path: String,
      generation: Long,
      digest: String,
      length: Long
    ) extends Observation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Observation.FileVersion.baboonDomainVersion
      override def baboonDomainIdentifier: String = Observation.FileVersion.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Observation.FileVersion.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Observation.FileVersion.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Observation.FileVersion.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Observation.FileVersion.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Observation.FileVersion.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Observation.FileVersion.baboonAdtType
    }
    
    object FileVersion {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Observation]#FileVersion"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Observation"
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.getClass
      def codecJson: BaboonJsonCodec[Observation.FileVersion] = Observation.FileVersion_JsonCodec.instance
    }
    
    object FileVersion_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Observation.FileVersion, BaboonJsonCodec[Observation.FileVersion]] {
      def encode(ctx: BaboonCodecContext, value: Observation.FileVersion): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "path" -> Json.fromString(value.path),
          "generation" -> Json.fromString(value.generation.toString),
          "digest" -> Json.fromString(value.digest),
          "length" -> Json.fromString(value.length.toString)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Observation.FileVersion] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
              generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
              digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
              length <- getField(jsonObject, "length").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            } yield Observation.FileVersion(path,generation,digest,length)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to FileVersion: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Observation.FileVersion.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Observation.FileVersion.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Observation.FileVersion.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Observation.FileVersion.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.FileVersion.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Observation.FileVersion]] = Lazy(Observation.FileVersion_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Observation.FileVersion]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Observation.FileVersion] = LazyInstance.value
    }
    
    
    final case class FileAbsent(
      path: String,
      generation: Long
    ) extends Observation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Observation.FileAbsent.baboonDomainVersion
      override def baboonDomainIdentifier: String = Observation.FileAbsent.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Observation.FileAbsent.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Observation.FileAbsent.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Observation.FileAbsent.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Observation.FileAbsent.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Observation.FileAbsent.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Observation.FileAbsent.baboonAdtType
    }
    
    object FileAbsent {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Observation]#FileAbsent"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Observation"
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.getClass
      def codecJson: BaboonJsonCodec[Observation.FileAbsent] = Observation.FileAbsent_JsonCodec.instance
    }
    
    object FileAbsent_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Observation.FileAbsent, BaboonJsonCodec[Observation.FileAbsent]] {
      def encode(ctx: BaboonCodecContext, value: Observation.FileAbsent): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "path" -> Json.fromString(value.path),
          "generation" -> Json.fromString(value.generation.toString)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Observation.FileAbsent] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
              generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            } yield Observation.FileAbsent(path,generation)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to FileAbsent: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Observation.FileAbsent.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Observation.FileAbsent.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Observation.FileAbsent.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Observation.FileAbsent.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.FileAbsent.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Observation.FileAbsent]] = Lazy(Observation.FileAbsent_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Observation.FileAbsent]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Observation.FileAbsent] = LazyInstance.value
    }
    
    
    final case class Execution(
      action: String,
      checker: String,
      contract: Option[Ref],
      artifacts: List[Ref],
      exitCode: Option[Int],
      complete: Boolean
    ) extends Observation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Observation.Execution.baboonDomainVersion
      override def baboonDomainIdentifier: String = Observation.Execution.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Observation.Execution.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Observation.Execution.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Observation.Execution.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Observation.Execution.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Observation.Execution.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Observation.Execution.baboonAdtType
    }
    
    object Execution {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Observation]#Execution"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Observation"
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.getClass
      def codecJson: BaboonJsonCodec[Observation.Execution] = Observation.Execution_JsonCodec.instance
    }
    
    object Execution_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Observation.Execution, BaboonJsonCodec[Observation.Execution]] {
      def encode(ctx: BaboonCodecContext, value: Observation.Execution): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "action" -> Json.fromString(value.action),
          "checker" -> Json.fromString(value.checker),
          "contract" -> value.contract.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
          "artifacts" -> Json.fromValues(value.artifacts.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "exitCode" -> value.exitCode.map(v => Json.fromInt(v)).getOrElse(Json.Null),
          "complete" -> Json.fromBoolean(value.complete)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Observation.Execution] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              action <- getField(jsonObject, "action").flatMap(v => decodeString(v.hcursor))
              checker <- getField(jsonObject, "checker").flatMap(v => decodeString(v.hcursor))
              contract <- getField(jsonObject, "contract").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
              artifacts <- getField(jsonObject, "artifacts").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              exitCode <- getField(jsonObject, "exitCode").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
              complete <- getField(jsonObject, "complete").flatMap(v => decodeBoolean(v.hcursor))
            } yield Observation.Execution(action,checker,contract,artifacts,exitCode,complete)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Execution: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Observation.Execution.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Observation.Execution.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Observation.Execution.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Observation.Execution.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Observation.Execution.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Observation.Execution]] = Lazy(Observation.Execution_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Observation.Execution]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Observation.Execution] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Observation"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Observation] = Observation_JsonCodec.instance
  }
  
  object Observation_JsonCodec extends BaboonJsonCodec.BaseGenerated[Observation, BaboonJsonCodec[Observation]] {
    def encode(ctx: BaboonCodecContext, value: Observation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case none: Observation.None => Json.obj("None" -> Observation.None_JsonCodec.instance.encode(ctx, none))
        
        case fileversion: Observation.FileVersion => Json.obj("FileVersion" -> Observation.FileVersion_JsonCodec.instance.encode(ctx, fileversion))
        
        case fileabsent: Observation.FileAbsent => Json.obj("FileAbsent" -> Observation.FileAbsent_JsonCodec.instance.encode(ctx, fileabsent))
        
        case execution: Observation.Execution => Json.obj("Execution" -> Observation.Execution_JsonCodec.instance.encode(ctx, execution))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Observation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "None" =>
                  Observation.None_JsonCodec.instance.decode(ctx, json)
                
                case "FileVersion" =>
                  Observation.FileVersion_JsonCodec.instance.decode(ctx, json)
                
                case "FileAbsent" =>
                  Observation.FileAbsent_JsonCodec.instance.decode(ctx, json)
                
                case "Execution" =>
                  Observation.Execution_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Observation: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Observation: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Observation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Observation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Observation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Observation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Observation]] = Lazy(Observation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Observation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Observation] = LazyInstance.value
  }
}