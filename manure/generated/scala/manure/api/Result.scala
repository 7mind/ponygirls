import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package manure.api {
  sealed trait Result extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Result.baboonDomainVersion
    override def baboonDomainIdentifier: String = Result.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Result.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Result.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Result.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Result.baboonMinReaderVersions
  }
  
  object Result {
    final case class Version(
      versions: VersionInfo
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.Version.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Version.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Version.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Version.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Version.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Version.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Version.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Version.baboonAdtType
    }
    
    object Version {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#Version"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.Version] = Result.Version_JsonCodec.instance
    }
    
    object Version_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Version, BaboonJsonCodec[Result.Version]] {
      def encode(ctx: BaboonCodecContext, value: Result.Version): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "versions" -> VersionInfo_JsonCodec.instance.encode(ctx, value.versions)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Version] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              versions <- getField(jsonObject, "versions").flatMap(v => VersionInfo_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Version(versions)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Version: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Version.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Version.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Version.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Version.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Version.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Version]] = Lazy(Result.Version_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Version]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Version] = LazyInstance.value
    }
    
    
    final case class CapabilityInfo(
      capabilities: Capabilities
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.CapabilityInfo.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.CapabilityInfo.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.CapabilityInfo.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.CapabilityInfo.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.CapabilityInfo.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.CapabilityInfo.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.CapabilityInfo.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.CapabilityInfo.baboonAdtType
    }
    
    object CapabilityInfo {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#CapabilityInfo"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.CapabilityInfo] = Result.CapabilityInfo_JsonCodec.instance
    }
    
    object CapabilityInfo_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.CapabilityInfo, BaboonJsonCodec[Result.CapabilityInfo]] {
      def encode(ctx: BaboonCodecContext, value: Result.CapabilityInfo): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "capabilities" -> Capabilities_JsonCodec.instance.encode(ctx, value.capabilities)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.CapabilityInfo] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              capabilities <- getField(jsonObject, "capabilities").flatMap(v => Capabilities_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.CapabilityInfo(capabilities)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapabilityInfo: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.CapabilityInfo.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.CapabilityInfo.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.CapabilityInfo.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.CapabilityInfo.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.CapabilityInfo.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.CapabilityInfo]] = Lazy(Result.CapabilityInfo_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.CapabilityInfo]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.CapabilityInfo] = LazyInstance.value
    }
    
    
    final case class Identity(
      principal: Principal
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.Identity.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Identity.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Identity.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Identity.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Identity.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Identity.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Identity.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Identity.baboonAdtType
    }
    
    object Identity {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#Identity"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.Identity] = Result.Identity_JsonCodec.instance
    }
    
    object Identity_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Identity, BaboonJsonCodec[Result.Identity]] {
      def encode(ctx: BaboonCodecContext, value: Result.Identity): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "principal" -> Principal_JsonCodec.instance.encode(ctx, value.principal)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Identity] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              principal <- getField(jsonObject, "principal").flatMap(v => Principal_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Identity(principal)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Identity: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Identity.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Identity.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Identity.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Identity.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Identity.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Identity]] = Lazy(Result.Identity_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Identity]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Identity] = LazyInstance.value
    }
    
    
    final case class Ok(
      
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.Ok.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Ok.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Ok.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Ok.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Ok.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Ok.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Ok.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Ok.baboonAdtType
    }
    
    object Ok {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#Ok"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.Ok] = Result.Ok_JsonCodec.instance
    }
    
    object Ok_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Ok, BaboonJsonCodec[Result.Ok]] {
      def encode(ctx: BaboonCodecContext, value: Result.Ok): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Ok] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Result.Ok())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Ok: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Ok.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Ok.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Ok.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Ok.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Ok.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Ok]] = Lazy(Result.Ok_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Ok]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Ok] = LazyInstance.value
    }
    
    
    final case class Catalogue(
      page: CataloguePage
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.Catalogue.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Catalogue.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Catalogue.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Catalogue.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Catalogue.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Catalogue.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Catalogue.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Catalogue.baboonAdtType
    }
    
    object Catalogue {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#Catalogue"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.Catalogue] = Result.Catalogue_JsonCodec.instance
    }
    
    object Catalogue_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Catalogue, BaboonJsonCodec[Result.Catalogue]] {
      def encode(ctx: BaboonCodecContext, value: Result.Catalogue): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "page" -> CataloguePage_JsonCodec.instance.encode(ctx, value.page)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Catalogue] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              page <- getField(jsonObject, "page").flatMap(v => CataloguePage_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Catalogue(page)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Catalogue: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Catalogue.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Catalogue.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Catalogue.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Catalogue.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Catalogue.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Catalogue]] = Lazy(Result.Catalogue_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Catalogue]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Catalogue] = LazyInstance.value
    }
    
    
    final case class UploadInitialized(
      artifactId: String,
      chunkBytes: Int,
      contentUrl: String,
      externalPassword: Option[String]
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.UploadInitialized.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.UploadInitialized.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.UploadInitialized.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.UploadInitialized.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.UploadInitialized.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.UploadInitialized.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.UploadInitialized.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadInitialized.baboonAdtType
    }
    
    object UploadInitialized {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#UploadInitialized"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.UploadInitialized] = Result.UploadInitialized_JsonCodec.instance
    }
    
    object UploadInitialized_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.UploadInitialized, BaboonJsonCodec[Result.UploadInitialized]] {
      def encode(ctx: BaboonCodecContext, value: Result.UploadInitialized): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId),
          "chunkBytes" -> Json.fromInt(value.chunkBytes),
          "contentUrl" -> Json.fromString(value.contentUrl),
          "externalPassword" -> value.externalPassword.map(v => Json.fromString(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.UploadInitialized] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
              chunkBytes <- getField(jsonObject, "chunkBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              contentUrl <- getField(jsonObject, "contentUrl").flatMap(v => decodeString(v.hcursor))
              externalPassword <- getField(jsonObject, "externalPassword").flatMap(v => decodeOption(decodeString)(v.hcursor))
            } yield Result.UploadInitialized(artifactId,chunkBytes,contentUrl,externalPassword)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadInitialized: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.UploadInitialized.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.UploadInitialized.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.UploadInitialized.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.UploadInitialized.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadInitialized.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.UploadInitialized]] = Lazy(Result.UploadInitialized_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.UploadInitialized]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.UploadInitialized] = LazyInstance.value
    }
    
    
    final case class ArtifactInfo(
      artifact: Artifact
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.ArtifactInfo.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.ArtifactInfo.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.ArtifactInfo.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.ArtifactInfo.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.ArtifactInfo.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.ArtifactInfo.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.ArtifactInfo.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactInfo.baboonAdtType
    }
    
    object ArtifactInfo {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#ArtifactInfo"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.ArtifactInfo] = Result.ArtifactInfo_JsonCodec.instance
    }
    
    object ArtifactInfo_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.ArtifactInfo, BaboonJsonCodec[Result.ArtifactInfo]] {
      def encode(ctx: BaboonCodecContext, value: Result.ArtifactInfo): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifact" -> Artifact_JsonCodec.instance.encode(ctx, value.artifact)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.ArtifactInfo] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifact <- getField(jsonObject, "artifact").flatMap(v => Artifact_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.ArtifactInfo(artifact)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArtifactInfo: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.ArtifactInfo.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.ArtifactInfo.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.ArtifactInfo.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.ArtifactInfo.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactInfo.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactInfo]] = Lazy(Result.ArtifactInfo_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactInfo]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.ArtifactInfo] = LazyInstance.value
    }
    
    
    final case class ArtifactPatched(
      artifact: Artifact,
      externalPassword: Option[String]
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.ArtifactPatched.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.ArtifactPatched.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.ArtifactPatched.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.ArtifactPatched.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.ArtifactPatched.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.ArtifactPatched.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.ArtifactPatched.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactPatched.baboonAdtType
    }
    
    object ArtifactPatched {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#ArtifactPatched"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.ArtifactPatched] = Result.ArtifactPatched_JsonCodec.instance
    }
    
    object ArtifactPatched_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.ArtifactPatched, BaboonJsonCodec[Result.ArtifactPatched]] {
      def encode(ctx: BaboonCodecContext, value: Result.ArtifactPatched): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifact" -> Artifact_JsonCodec.instance.encode(ctx, value.artifact),
          "externalPassword" -> value.externalPassword.map(v => Json.fromString(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.ArtifactPatched] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifact <- getField(jsonObject, "artifact").flatMap(v => Artifact_JsonCodec.circeDecoder(v.hcursor))
              externalPassword <- getField(jsonObject, "externalPassword").flatMap(v => decodeOption(decodeString)(v.hcursor))
            } yield Result.ArtifactPatched(artifact,externalPassword)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArtifactPatched: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.ArtifactPatched.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.ArtifactPatched.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.ArtifactPatched.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.ArtifactPatched.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactPatched.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactPatched]] = Lazy(Result.ArtifactPatched_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactPatched]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.ArtifactPatched] = LazyInstance.value
    }
    
    
    final case class PasswordRotated(
      externalPassword: String
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.PasswordRotated.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.PasswordRotated.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.PasswordRotated.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.PasswordRotated.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.PasswordRotated.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.PasswordRotated.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.PasswordRotated.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.PasswordRotated.baboonAdtType
    }
    
    object PasswordRotated {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#PasswordRotated"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.PasswordRotated] = Result.PasswordRotated_JsonCodec.instance
    }
    
    object PasswordRotated_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.PasswordRotated, BaboonJsonCodec[Result.PasswordRotated]] {
      def encode(ctx: BaboonCodecContext, value: Result.PasswordRotated): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "externalPassword" -> Json.fromString(value.externalPassword)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.PasswordRotated] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              externalPassword <- getField(jsonObject, "externalPassword").flatMap(v => decodeString(v.hcursor))
            } yield Result.PasswordRotated(externalPassword)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to PasswordRotated: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.PasswordRotated.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.PasswordRotated.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.PasswordRotated.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.PasswordRotated.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.PasswordRotated.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.PasswordRotated]] = Lazy(Result.PasswordRotated_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.PasswordRotated]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.PasswordRotated] = LazyInstance.value
    }
    
    
    final case class ExternalPasswordRetrieved(
      externalPassword: Option[String]
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.ExternalPasswordRetrieved.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.ExternalPasswordRetrieved.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.ExternalPasswordRetrieved.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.ExternalPasswordRetrieved.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.ExternalPasswordRetrieved.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.ExternalPasswordRetrieved.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.ExternalPasswordRetrieved.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.ExternalPasswordRetrieved.baboonAdtType
    }
    
    object ExternalPasswordRetrieved {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.ExternalPasswordRetrieved] = Result.ExternalPasswordRetrieved_JsonCodec.instance
    }
    
    object ExternalPasswordRetrieved_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.ExternalPasswordRetrieved, BaboonJsonCodec[Result.ExternalPasswordRetrieved]] {
      def encode(ctx: BaboonCodecContext, value: Result.ExternalPasswordRetrieved): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "externalPassword" -> value.externalPassword.map(v => Json.fromString(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.ExternalPasswordRetrieved] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              externalPassword <- getField(jsonObject, "externalPassword").flatMap(v => decodeOption(decodeString)(v.hcursor))
            } yield Result.ExternalPasswordRetrieved(externalPassword)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ExternalPasswordRetrieved: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.ExternalPasswordRetrieved.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.ExternalPasswordRetrieved.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.ExternalPasswordRetrieved.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.ExternalPasswordRetrieved.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.ExternalPasswordRetrieved.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.ExternalPasswordRetrieved]] = Lazy(Result.ExternalPasswordRetrieved_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.ExternalPasswordRetrieved]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.ExternalPasswordRetrieved] = LazyInstance.value
    }
    
    
    final case class ArtifactManifest(
      manifest: Manifest
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.ArtifactManifest.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.ArtifactManifest.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.ArtifactManifest.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.ArtifactManifest.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.ArtifactManifest.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.ArtifactManifest.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.ArtifactManifest.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactManifest.baboonAdtType
    }
    
    object ArtifactManifest {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#ArtifactManifest"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.ArtifactManifest] = Result.ArtifactManifest_JsonCodec.instance
    }
    
    object ArtifactManifest_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.ArtifactManifest, BaboonJsonCodec[Result.ArtifactManifest]] {
      def encode(ctx: BaboonCodecContext, value: Result.ArtifactManifest): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "manifest" -> Manifest_JsonCodec.instance.encode(ctx, value.manifest)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.ArtifactManifest] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              manifest <- getField(jsonObject, "manifest").flatMap(v => Manifest_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.ArtifactManifest(manifest)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArtifactManifest: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.ArtifactManifest.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.ArtifactManifest.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.ArtifactManifest.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.ArtifactManifest.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.ArtifactManifest.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactManifest]] = Lazy(Result.ArtifactManifest_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.ArtifactManifest]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.ArtifactManifest] = LazyInstance.value
    }
    
    
    final case class UploadProgress(
      status: UploadStatus
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.UploadProgress.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.UploadProgress.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.UploadProgress.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.UploadProgress.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.UploadProgress.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.UploadProgress.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.UploadProgress.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadProgress.baboonAdtType
    }
    
    object UploadProgress {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#UploadProgress"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.UploadProgress] = Result.UploadProgress_JsonCodec.instance
    }
    
    object UploadProgress_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.UploadProgress, BaboonJsonCodec[Result.UploadProgress]] {
      def encode(ctx: BaboonCodecContext, value: Result.UploadProgress): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "status" -> UploadStatus_JsonCodec.instance.encode(ctx, value.status)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.UploadProgress] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              status <- getField(jsonObject, "status").flatMap(v => UploadStatus_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.UploadProgress(status)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadProgress: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.UploadProgress.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.UploadProgress.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.UploadProgress.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.UploadProgress.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadProgress.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.UploadProgress]] = Lazy(Result.UploadProgress_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.UploadProgress]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.UploadProgress] = LazyInstance.value
    }
    
    
    final case class UploadFinished(
      artifactId: String,
      state: ArtifactState,
      contentUrl: String
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.UploadFinished.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.UploadFinished.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.UploadFinished.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.UploadFinished.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.UploadFinished.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.UploadFinished.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.UploadFinished.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadFinished.baboonAdtType
    }
    
    object UploadFinished {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#UploadFinished"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.UploadFinished] = Result.UploadFinished_JsonCodec.instance
    }
    
    object UploadFinished_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.UploadFinished, BaboonJsonCodec[Result.UploadFinished]] {
      def encode(ctx: BaboonCodecContext, value: Result.UploadFinished): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId),
          "state" -> ArtifactState_JsonCodec.instance.encode(ctx, value.state),
          "contentUrl" -> Json.fromString(value.contentUrl)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.UploadFinished] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
              state <- getField(jsonObject, "state").flatMap(v => ArtifactState_JsonCodec.circeDecoder(v.hcursor))
              contentUrl <- getField(jsonObject, "contentUrl").flatMap(v => decodeString(v.hcursor))
            } yield Result.UploadFinished(artifactId,state,contentUrl)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadFinished: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.UploadFinished.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.UploadFinished.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.UploadFinished.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.UploadFinished.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.UploadFinished.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.UploadFinished]] = Lazy(Result.UploadFinished_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.UploadFinished]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.UploadFinished] = LazyInstance.value
    }
    
    
    final case class GrantCreated(
      grant: String,
      expiresInSeconds: Int
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.GrantCreated.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.GrantCreated.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.GrantCreated.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.GrantCreated.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.GrantCreated.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.GrantCreated.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.GrantCreated.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.GrantCreated.baboonAdtType
    }
    
    object GrantCreated {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#GrantCreated"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.GrantCreated] = Result.GrantCreated_JsonCodec.instance
    }
    
    object GrantCreated_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.GrantCreated, BaboonJsonCodec[Result.GrantCreated]] {
      def encode(ctx: BaboonCodecContext, value: Result.GrantCreated): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "grant" -> Json.fromString(value.grant),
          "expiresInSeconds" -> Json.fromInt(value.expiresInSeconds)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.GrantCreated] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              grant <- getField(jsonObject, "grant").flatMap(v => decodeString(v.hcursor))
              expiresInSeconds <- getField(jsonObject, "expiresInSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            } yield Result.GrantCreated(grant,expiresInSeconds)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GrantCreated: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.GrantCreated.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.GrantCreated.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.GrantCreated.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.GrantCreated.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.GrantCreated.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.GrantCreated]] = Lazy(Result.GrantCreated_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.GrantCreated]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.GrantCreated] = LazyInstance.value
    }
    
    
    final case class SearchResults(
      page: SearchPage
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.SearchResults.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.SearchResults.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.SearchResults.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.SearchResults.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.SearchResults.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.SearchResults.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.SearchResults.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.SearchResults.baboonAdtType
    }
    
    object SearchResults {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#SearchResults"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.SearchResults] = Result.SearchResults_JsonCodec.instance
    }
    
    object SearchResults_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.SearchResults, BaboonJsonCodec[Result.SearchResults]] {
      def encode(ctx: BaboonCodecContext, value: Result.SearchResults): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "page" -> SearchPage_JsonCodec.instance.encode(ctx, value.page)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.SearchResults] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              page <- getField(jsonObject, "page").flatMap(v => SearchPage_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.SearchResults(page)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchResults: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.SearchResults.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.SearchResults.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.SearchResults.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.SearchResults.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.SearchResults.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.SearchResults]] = Lazy(Result.SearchResults_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.SearchResults]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.SearchResults] = LazyInstance.value
    }
    
    
    final case class Error(
      failure: Failure
    ) extends Result with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Result.Error.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Error.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Error.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Error.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Error.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Error.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Error.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Error.baboonAdtType
    }
    
    object Error {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Result]#Error"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      def codecJson: BaboonJsonCodec[Result.Error] = Result.Error_JsonCodec.instance
    }
    
    object Error_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Error, BaboonJsonCodec[Result.Error]] {
      def encode(ctx: BaboonCodecContext, value: Result.Error): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "failure" -> Failure_JsonCodec.instance.encode(ctx, value.failure)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Error] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              failure <- getField(jsonObject, "failure").flatMap(v => Failure_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Error(failure)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Error: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Error.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Error.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Error.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Error.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Error.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Error]] = Lazy(Result.Error_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Error]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Error] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Result"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Result] = Result_JsonCodec.instance
  }
  
  object Result_JsonCodec extends BaboonJsonCodec.BaseGenerated[Result, BaboonJsonCodec[Result]] {
    def encode(ctx: BaboonCodecContext, value: Result): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case version: Result.Version => Json.obj("Version" -> Result.Version_JsonCodec.instance.encode(ctx, version))
        
        case capabilityinfo: Result.CapabilityInfo => Json.obj("CapabilityInfo" -> Result.CapabilityInfo_JsonCodec.instance.encode(ctx, capabilityinfo))
        
        case identity: Result.Identity => Json.obj("Identity" -> Result.Identity_JsonCodec.instance.encode(ctx, identity))
        
        case ok: Result.Ok => Json.obj("Ok" -> Result.Ok_JsonCodec.instance.encode(ctx, ok))
        
        case catalogue: Result.Catalogue => Json.obj("Catalogue" -> Result.Catalogue_JsonCodec.instance.encode(ctx, catalogue))
        
        case uploadinitialized: Result.UploadInitialized => Json.obj("UploadInitialized" -> Result.UploadInitialized_JsonCodec.instance.encode(ctx, uploadinitialized))
        
        case artifactinfo: Result.ArtifactInfo => Json.obj("ArtifactInfo" -> Result.ArtifactInfo_JsonCodec.instance.encode(ctx, artifactinfo))
        
        case artifactpatched: Result.ArtifactPatched => Json.obj("ArtifactPatched" -> Result.ArtifactPatched_JsonCodec.instance.encode(ctx, artifactpatched))
        
        case passwordrotated: Result.PasswordRotated => Json.obj("PasswordRotated" -> Result.PasswordRotated_JsonCodec.instance.encode(ctx, passwordrotated))
        
        case externalpasswordretrieved: Result.ExternalPasswordRetrieved => Json.obj("ExternalPasswordRetrieved" -> Result.ExternalPasswordRetrieved_JsonCodec.instance.encode(ctx, externalpasswordretrieved))
        
        case artifactmanifest: Result.ArtifactManifest => Json.obj("ArtifactManifest" -> Result.ArtifactManifest_JsonCodec.instance.encode(ctx, artifactmanifest))
        
        case uploadprogress: Result.UploadProgress => Json.obj("UploadProgress" -> Result.UploadProgress_JsonCodec.instance.encode(ctx, uploadprogress))
        
        case uploadfinished: Result.UploadFinished => Json.obj("UploadFinished" -> Result.UploadFinished_JsonCodec.instance.encode(ctx, uploadfinished))
        
        case grantcreated: Result.GrantCreated => Json.obj("GrantCreated" -> Result.GrantCreated_JsonCodec.instance.encode(ctx, grantcreated))
        
        case searchresults: Result.SearchResults => Json.obj("SearchResults" -> Result.SearchResults_JsonCodec.instance.encode(ctx, searchresults))
        
        case error: Result.Error => Json.obj("Error" -> Result.Error_JsonCodec.instance.encode(ctx, error))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Version" =>
                  Result.Version_JsonCodec.instance.decode(ctx, json)
                
                case "CapabilityInfo" =>
                  Result.CapabilityInfo_JsonCodec.instance.decode(ctx, json)
                
                case "Identity" =>
                  Result.Identity_JsonCodec.instance.decode(ctx, json)
                
                case "Ok" =>
                  Result.Ok_JsonCodec.instance.decode(ctx, json)
                
                case "Catalogue" =>
                  Result.Catalogue_JsonCodec.instance.decode(ctx, json)
                
                case "UploadInitialized" =>
                  Result.UploadInitialized_JsonCodec.instance.decode(ctx, json)
                
                case "ArtifactInfo" =>
                  Result.ArtifactInfo_JsonCodec.instance.decode(ctx, json)
                
                case "ArtifactPatched" =>
                  Result.ArtifactPatched_JsonCodec.instance.decode(ctx, json)
                
                case "PasswordRotated" =>
                  Result.PasswordRotated_JsonCodec.instance.decode(ctx, json)
                
                case "ExternalPasswordRetrieved" =>
                  Result.ExternalPasswordRetrieved_JsonCodec.instance.decode(ctx, json)
                
                case "ArtifactManifest" =>
                  Result.ArtifactManifest_JsonCodec.instance.decode(ctx, json)
                
                case "UploadProgress" =>
                  Result.UploadProgress_JsonCodec.instance.decode(ctx, json)
                
                case "UploadFinished" =>
                  Result.UploadFinished_JsonCodec.instance.decode(ctx, json)
                
                case "GrantCreated" =>
                  Result.GrantCreated_JsonCodec.instance.decode(ctx, json)
                
                case "SearchResults" =>
                  Result.SearchResults_JsonCodec.instance.decode(ctx, json)
                
                case "Error" =>
                  Result.Error_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Result: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Result: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Result: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Result.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Result.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Result.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result]] = Lazy(Result_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Result]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Result] = LazyInstance.value
  }
}