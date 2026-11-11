
import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  sealed trait Command extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Command.baboonDomainVersion
    override def baboonDomainIdentifier: String = Command.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Command.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Command.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Command.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Command.baboonMinReaderVersions
  }
  
  object Command {
    final case class Version(
      
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.Version.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.Version.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.Version.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.Version.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.Version.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.Version.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.Version.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.Version.baboonAdtType
    }
    
    object Version {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#Version"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.Version] = Command.Version_JsonCodec.instance
    }
    
    object Version_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.Version, BaboonJsonCodec[Command.Version]] {
      def encode(ctx: BaboonCodecContext, value: Command.Version): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.Version] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Command.Version())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Version: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.Version.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.Version.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.Version.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.Version.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.Version.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.Version]] = Lazy(Command.Version_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.Version]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.Version] = LazyInstance.value
    }
    
    
    final case class GetCapabilities(
      
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.GetCapabilities.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.GetCapabilities.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.GetCapabilities.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.GetCapabilities.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.GetCapabilities.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.GetCapabilities.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.GetCapabilities.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.GetCapabilities.baboonAdtType
    }
    
    object GetCapabilities {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#GetCapabilities"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.GetCapabilities] = Command.GetCapabilities_JsonCodec.instance
    }
    
    object GetCapabilities_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.GetCapabilities, BaboonJsonCodec[Command.GetCapabilities]] {
      def encode(ctx: BaboonCodecContext, value: Command.GetCapabilities): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.GetCapabilities] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Command.GetCapabilities())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetCapabilities: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.GetCapabilities.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.GetCapabilities.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.GetCapabilities.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.GetCapabilities.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.GetCapabilities.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.GetCapabilities]] = Lazy(Command.GetCapabilities_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.GetCapabilities]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.GetCapabilities] = LazyInstance.value
    }
    
    
    final case class Login(
      token: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.Login.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.Login.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.Login.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.Login.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.Login.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.Login.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.Login.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.Login.baboonAdtType
    }
    
    object Login {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#Login"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.Login] = Command.Login_JsonCodec.instance
    }
    
    object Login_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.Login, BaboonJsonCodec[Command.Login]] {
      def encode(ctx: BaboonCodecContext, value: Command.Login): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "token" -> Json.fromString(value.token)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.Login] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              token <- getField(jsonObject, "token").flatMap(v => decodeString(v.hcursor))
            } yield Command.Login(token)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Login: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.Login.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.Login.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.Login.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.Login.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.Login.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.Login]] = Lazy(Command.Login_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.Login]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.Login] = LazyInstance.value
    }
    
    
    final case class Logout(
      
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.Logout.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.Logout.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.Logout.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.Logout.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.Logout.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.Logout.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.Logout.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.Logout.baboonAdtType
    }
    
    object Logout {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#Logout"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.Logout] = Command.Logout_JsonCodec.instance
    }
    
    object Logout_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.Logout, BaboonJsonCodec[Command.Logout]] {
      def encode(ctx: BaboonCodecContext, value: Command.Logout): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.Logout] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Command.Logout())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Logout: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.Logout.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.Logout.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.Logout.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.Logout.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.Logout.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.Logout]] = Lazy(Command.Logout_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.Logout]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.Logout] = LazyInstance.value
    }
    
    
    final case class Whoami(
      
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.Whoami.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.Whoami.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.Whoami.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.Whoami.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.Whoami.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.Whoami.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.Whoami.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.Whoami.baboonAdtType
    }
    
    object Whoami {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#Whoami"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.Whoami] = Command.Whoami_JsonCodec.instance
    }
    
    object Whoami_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.Whoami, BaboonJsonCodec[Command.Whoami]] {
      def encode(ctx: BaboonCodecContext, value: Command.Whoami): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.Whoami] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Command.Whoami())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Whoami: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.Whoami.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.Whoami.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.Whoami.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.Whoami.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.Whoami.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.Whoami]] = Lazy(Command.Whoami_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.Whoami]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.Whoami] = LazyInstance.value
    }
    
    
    final case class ListArtifacts(
      query: CatalogueQuery
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.ListArtifacts.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.ListArtifacts.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.ListArtifacts.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.ListArtifacts.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.ListArtifacts.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.ListArtifacts.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.ListArtifacts.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.ListArtifacts.baboonAdtType
    }
    
    object ListArtifacts {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#ListArtifacts"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.ListArtifacts] = Command.ListArtifacts_JsonCodec.instance
    }
    
    object ListArtifacts_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.ListArtifacts, BaboonJsonCodec[Command.ListArtifacts]] {
      def encode(ctx: BaboonCodecContext, value: Command.ListArtifacts): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "query" -> CatalogueQuery_JsonCodec.instance.encode(ctx, value.query)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.ListArtifacts] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              query <- getField(jsonObject, "query").flatMap(v => CatalogueQuery_JsonCodec.circeDecoder(v.hcursor))
            } yield Command.ListArtifacts(query)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ListArtifacts: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.ListArtifacts.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.ListArtifacts.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.ListArtifacts.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.ListArtifacts.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.ListArtifacts.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.ListArtifacts]] = Lazy(Command.ListArtifacts_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.ListArtifacts]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.ListArtifacts] = LazyInstance.value
    }
    
    
    final case class InitUpload(
      name: String,
      kind: ArtifactKind,
      visibility: Visibility,
      expiresInSeconds: Option[Int],
      files: List[ManifestEntry],
      tags: List[String],
      hostname: Option[String],
      projectPath: Option[String]
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.InitUpload.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.InitUpload.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.InitUpload.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.InitUpload.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.InitUpload.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.InitUpload.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.InitUpload.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.InitUpload.baboonAdtType
    }
    
    object InitUpload {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#InitUpload"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.InitUpload] = Command.InitUpload_JsonCodec.instance
    }
    
    object InitUpload_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.InitUpload, BaboonJsonCodec[Command.InitUpload]] {
      def encode(ctx: BaboonCodecContext, value: Command.InitUpload): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "name" -> Json.fromString(value.name),
          "kind" -> ArtifactKind_JsonCodec.instance.encode(ctx, value.kind),
          "visibility" -> Visibility_JsonCodec.instance.encode(ctx, value.visibility),
          "expiresInSeconds" -> value.expiresInSeconds.map(v => Json.fromInt(v)).getOrElse(Json.Null),
          "files" -> Json.fromValues(value.files.map(e => ManifestEntry_JsonCodec.instance.encode(ctx, e))),
          "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
          "hostname" -> value.hostname.map(v => Json.fromString(v)).getOrElse(Json.Null),
          "projectPath" -> value.projectPath.map(v => Json.fromString(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.InitUpload] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
              kind <- getField(jsonObject, "kind").flatMap(v => ArtifactKind_JsonCodec.circeDecoder(v.hcursor))
              visibility <- getField(jsonObject, "visibility").flatMap(v => Visibility_JsonCodec.circeDecoder(v.hcursor))
              expiresInSeconds <- getField(jsonObject, "expiresInSeconds").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
              files <- getField(jsonObject, "files").flatMap(v => decodeList(ManifestEntry_JsonCodec.circeDecoder)(v.hcursor))
              tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
              hostname <- getField(jsonObject, "hostname").flatMap(v => decodeOption(decodeString)(v.hcursor))
              projectPath <- getField(jsonObject, "projectPath").flatMap(v => decodeOption(decodeString)(v.hcursor))
            } yield Command.InitUpload(name,kind,visibility,expiresInSeconds,files,tags,hostname,projectPath)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to InitUpload: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.InitUpload.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.InitUpload.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.InitUpload.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.InitUpload.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.InitUpload.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.InitUpload]] = Lazy(Command.InitUpload_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.InitUpload]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.InitUpload] = LazyInstance.value
    }
    
    
    final case class GetArtifact(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.GetArtifact.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.GetArtifact.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.GetArtifact.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.GetArtifact.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.GetArtifact.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.GetArtifact.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.GetArtifact.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.GetArtifact.baboonAdtType
    }
    
    object GetArtifact {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#GetArtifact"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.GetArtifact] = Command.GetArtifact_JsonCodec.instance
    }
    
    object GetArtifact_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.GetArtifact, BaboonJsonCodec[Command.GetArtifact]] {
      def encode(ctx: BaboonCodecContext, value: Command.GetArtifact): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.GetArtifact] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.GetArtifact(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetArtifact: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.GetArtifact.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.GetArtifact.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.GetArtifact.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.GetArtifact.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.GetArtifact.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.GetArtifact]] = Lazy(Command.GetArtifact_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.GetArtifact]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.GetArtifact] = LazyInstance.value
    }
    
    
    final case class PatchArtifact(
      artifactId: String,
      patch: ArtifactPatch
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.PatchArtifact.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.PatchArtifact.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.PatchArtifact.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.PatchArtifact.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.PatchArtifact.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.PatchArtifact.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.PatchArtifact.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.PatchArtifact.baboonAdtType
    }
    
    object PatchArtifact {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#PatchArtifact"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.PatchArtifact] = Command.PatchArtifact_JsonCodec.instance
    }
    
    object PatchArtifact_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.PatchArtifact, BaboonJsonCodec[Command.PatchArtifact]] {
      def encode(ctx: BaboonCodecContext, value: Command.PatchArtifact): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId),
          "patch" -> ArtifactPatch_JsonCodec.instance.encode(ctx, value.patch)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.PatchArtifact] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
              patch <- getField(jsonObject, "patch").flatMap(v => ArtifactPatch_JsonCodec.circeDecoder(v.hcursor))
            } yield Command.PatchArtifact(artifactId,patch)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to PatchArtifact: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.PatchArtifact.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.PatchArtifact.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.PatchArtifact.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.PatchArtifact.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.PatchArtifact.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.PatchArtifact]] = Lazy(Command.PatchArtifact_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.PatchArtifact]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.PatchArtifact] = LazyInstance.value
    }
    
    
    final case class DeleteArtifact(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.DeleteArtifact.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.DeleteArtifact.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.DeleteArtifact.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.DeleteArtifact.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.DeleteArtifact.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.DeleteArtifact.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.DeleteArtifact.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.DeleteArtifact.baboonAdtType
    }
    
    object DeleteArtifact {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#DeleteArtifact"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.DeleteArtifact] = Command.DeleteArtifact_JsonCodec.instance
    }
    
    object DeleteArtifact_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.DeleteArtifact, BaboonJsonCodec[Command.DeleteArtifact]] {
      def encode(ctx: BaboonCodecContext, value: Command.DeleteArtifact): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.DeleteArtifact] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.DeleteArtifact(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeleteArtifact: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.DeleteArtifact.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.DeleteArtifact.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.DeleteArtifact.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.DeleteArtifact.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.DeleteArtifact.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.DeleteArtifact]] = Lazy(Command.DeleteArtifact_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.DeleteArtifact]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.DeleteArtifact] = LazyInstance.value
    }
    
    
    final case class RotateExternalPassword(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.RotateExternalPassword.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.RotateExternalPassword.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.RotateExternalPassword.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.RotateExternalPassword.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.RotateExternalPassword.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.RotateExternalPassword.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.RotateExternalPassword.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.RotateExternalPassword.baboonAdtType
    }
    
    object RotateExternalPassword {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#RotateExternalPassword"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.RotateExternalPassword] = Command.RotateExternalPassword_JsonCodec.instance
    }
    
    object RotateExternalPassword_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.RotateExternalPassword, BaboonJsonCodec[Command.RotateExternalPassword]] {
      def encode(ctx: BaboonCodecContext, value: Command.RotateExternalPassword): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.RotateExternalPassword] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.RotateExternalPassword(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RotateExternalPassword: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.RotateExternalPassword.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.RotateExternalPassword.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.RotateExternalPassword.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.RotateExternalPassword.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.RotateExternalPassword.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.RotateExternalPassword]] = Lazy(Command.RotateExternalPassword_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.RotateExternalPassword]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.RotateExternalPassword] = LazyInstance.value
    }
    
    
    final case class GetExternalPassword(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.GetExternalPassword.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.GetExternalPassword.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.GetExternalPassword.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.GetExternalPassword.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.GetExternalPassword.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.GetExternalPassword.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.GetExternalPassword.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.GetExternalPassword.baboonAdtType
    }
    
    object GetExternalPassword {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#GetExternalPassword"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.GetExternalPassword] = Command.GetExternalPassword_JsonCodec.instance
    }
    
    object GetExternalPassword_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.GetExternalPassword, BaboonJsonCodec[Command.GetExternalPassword]] {
      def encode(ctx: BaboonCodecContext, value: Command.GetExternalPassword): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.GetExternalPassword] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.GetExternalPassword(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetExternalPassword: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.GetExternalPassword.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.GetExternalPassword.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.GetExternalPassword.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.GetExternalPassword.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.GetExternalPassword.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.GetExternalPassword]] = Lazy(Command.GetExternalPassword_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.GetExternalPassword]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.GetExternalPassword] = LazyInstance.value
    }
    
    
    final case class GetManifest(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.GetManifest.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.GetManifest.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.GetManifest.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.GetManifest.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.GetManifest.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.GetManifest.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.GetManifest.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.GetManifest.baboonAdtType
    }
    
    object GetManifest {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#GetManifest"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.GetManifest] = Command.GetManifest_JsonCodec.instance
    }
    
    object GetManifest_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.GetManifest, BaboonJsonCodec[Command.GetManifest]] {
      def encode(ctx: BaboonCodecContext, value: Command.GetManifest): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.GetManifest] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.GetManifest(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetManifest: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.GetManifest.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.GetManifest.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.GetManifest.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.GetManifest.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.GetManifest.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.GetManifest]] = Lazy(Command.GetManifest_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.GetManifest]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.GetManifest] = LazyInstance.value
    }
    
    
    final case class GetUploadStatus(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.GetUploadStatus.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.GetUploadStatus.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.GetUploadStatus.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.GetUploadStatus.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.GetUploadStatus.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.GetUploadStatus.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.GetUploadStatus.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.GetUploadStatus.baboonAdtType
    }
    
    object GetUploadStatus {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#GetUploadStatus"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.GetUploadStatus] = Command.GetUploadStatus_JsonCodec.instance
    }
    
    object GetUploadStatus_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.GetUploadStatus, BaboonJsonCodec[Command.GetUploadStatus]] {
      def encode(ctx: BaboonCodecContext, value: Command.GetUploadStatus): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.GetUploadStatus] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.GetUploadStatus(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetUploadStatus: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.GetUploadStatus.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.GetUploadStatus.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.GetUploadStatus.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.GetUploadStatus.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.GetUploadStatus.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.GetUploadStatus]] = Lazy(Command.GetUploadStatus_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.GetUploadStatus]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.GetUploadStatus] = LazyInstance.value
    }
    
    
    final case class FinishUpload(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.FinishUpload.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.FinishUpload.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.FinishUpload.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.FinishUpload.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.FinishUpload.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.FinishUpload.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.FinishUpload.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.FinishUpload.baboonAdtType
    }
    
    object FinishUpload {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#FinishUpload"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.FinishUpload] = Command.FinishUpload_JsonCodec.instance
    }
    
    object FinishUpload_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.FinishUpload, BaboonJsonCodec[Command.FinishUpload]] {
      def encode(ctx: BaboonCodecContext, value: Command.FinishUpload): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.FinishUpload] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.FinishUpload(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to FinishUpload: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.FinishUpload.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.FinishUpload.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.FinishUpload.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.FinishUpload.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.FinishUpload.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.FinishUpload]] = Lazy(Command.FinishUpload_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.FinishUpload]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.FinishUpload] = LazyInstance.value
    }
    
    
    final case class CreateGrant(
      artifactId: String
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.CreateGrant.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.CreateGrant.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.CreateGrant.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.CreateGrant.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.CreateGrant.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.CreateGrant.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.CreateGrant.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.CreateGrant.baboonAdtType
    }
    
    object CreateGrant {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#CreateGrant"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.CreateGrant] = Command.CreateGrant_JsonCodec.instance
    }
    
    object CreateGrant_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.CreateGrant, BaboonJsonCodec[Command.CreateGrant]] {
      def encode(ctx: BaboonCodecContext, value: Command.CreateGrant): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "artifactId" -> Json.fromString(value.artifactId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.CreateGrant] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            } yield Command.CreateGrant(artifactId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to CreateGrant: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.CreateGrant.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.CreateGrant.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.CreateGrant.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.CreateGrant.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.CreateGrant.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.CreateGrant]] = Lazy(Command.CreateGrant_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.CreateGrant]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.CreateGrant] = LazyInstance.value
    }
    
    
    final case class Search(
      query: SearchQuery
    ) extends Command with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Command.Search.baboonDomainVersion
      override def baboonDomainIdentifier: String = Command.Search.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Command.Search.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Command.Search.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Command.Search.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Command.Search.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Command.Search.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Command.Search.baboonAdtType
    }
    
    object Search {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#Command]#Search"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#Command"
      def baboonAdtType: _root_.java.lang.Class[?] = Command.getClass
      def codecJson: BaboonJsonCodec[Command.Search] = Command.Search_JsonCodec.instance
    }
    
    object Search_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Command.Search, BaboonJsonCodec[Command.Search]] {
      def encode(ctx: BaboonCodecContext, value: Command.Search): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "query" -> SearchQuery_JsonCodec.instance.encode(ctx, value.query)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command.Search] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              query <- getField(jsonObject, "query").flatMap(v => SearchQuery_JsonCodec.circeDecoder(v.hcursor))
            } yield Command.Search(query)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Search: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Command.Search.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Command.Search.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Command.Search.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Command.Search.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Command.Search.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command.Search]] = Lazy(Command.Search_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Command.Search]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Command.Search] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Command"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Command] = Command_JsonCodec.instance
  }
  
  object Command_JsonCodec extends BaboonJsonCodec.BaseGenerated[Command, BaboonJsonCodec[Command]] {
    def encode(ctx: BaboonCodecContext, value: Command): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case version: Command.Version => Json.obj("Version" -> Command.Version_JsonCodec.instance.encode(ctx, version))
        
        case getcapabilities: Command.GetCapabilities => Json.obj("GetCapabilities" -> Command.GetCapabilities_JsonCodec.instance.encode(ctx, getcapabilities))
        
        case login: Command.Login => Json.obj("Login" -> Command.Login_JsonCodec.instance.encode(ctx, login))
        
        case logout: Command.Logout => Json.obj("Logout" -> Command.Logout_JsonCodec.instance.encode(ctx, logout))
        
        case whoami: Command.Whoami => Json.obj("Whoami" -> Command.Whoami_JsonCodec.instance.encode(ctx, whoami))
        
        case listartifacts: Command.ListArtifacts => Json.obj("ListArtifacts" -> Command.ListArtifacts_JsonCodec.instance.encode(ctx, listartifacts))
        
        case initupload: Command.InitUpload => Json.obj("InitUpload" -> Command.InitUpload_JsonCodec.instance.encode(ctx, initupload))
        
        case getartifact: Command.GetArtifact => Json.obj("GetArtifact" -> Command.GetArtifact_JsonCodec.instance.encode(ctx, getartifact))
        
        case patchartifact: Command.PatchArtifact => Json.obj("PatchArtifact" -> Command.PatchArtifact_JsonCodec.instance.encode(ctx, patchartifact))
        
        case deleteartifact: Command.DeleteArtifact => Json.obj("DeleteArtifact" -> Command.DeleteArtifact_JsonCodec.instance.encode(ctx, deleteartifact))
        
        case rotateexternalpassword: Command.RotateExternalPassword => Json.obj("RotateExternalPassword" -> Command.RotateExternalPassword_JsonCodec.instance.encode(ctx, rotateexternalpassword))
        
        case getexternalpassword: Command.GetExternalPassword => Json.obj("GetExternalPassword" -> Command.GetExternalPassword_JsonCodec.instance.encode(ctx, getexternalpassword))
        
        case getmanifest: Command.GetManifest => Json.obj("GetManifest" -> Command.GetManifest_JsonCodec.instance.encode(ctx, getmanifest))
        
        case getuploadstatus: Command.GetUploadStatus => Json.obj("GetUploadStatus" -> Command.GetUploadStatus_JsonCodec.instance.encode(ctx, getuploadstatus))
        
        case finishupload: Command.FinishUpload => Json.obj("FinishUpload" -> Command.FinishUpload_JsonCodec.instance.encode(ctx, finishupload))
        
        case creategrant: Command.CreateGrant => Json.obj("CreateGrant" -> Command.CreateGrant_JsonCodec.instance.encode(ctx, creategrant))
        
        case search: Command.Search => Json.obj("Search" -> Command.Search_JsonCodec.instance.encode(ctx, search))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Command] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Version" =>
                  Command.Version_JsonCodec.instance.decode(ctx, json)
                
                case "GetCapabilities" =>
                  Command.GetCapabilities_JsonCodec.instance.decode(ctx, json)
                
                case "Login" =>
                  Command.Login_JsonCodec.instance.decode(ctx, json)
                
                case "Logout" =>
                  Command.Logout_JsonCodec.instance.decode(ctx, json)
                
                case "Whoami" =>
                  Command.Whoami_JsonCodec.instance.decode(ctx, json)
                
                case "ListArtifacts" =>
                  Command.ListArtifacts_JsonCodec.instance.decode(ctx, json)
                
                case "InitUpload" =>
                  Command.InitUpload_JsonCodec.instance.decode(ctx, json)
                
                case "GetArtifact" =>
                  Command.GetArtifact_JsonCodec.instance.decode(ctx, json)
                
                case "PatchArtifact" =>
                  Command.PatchArtifact_JsonCodec.instance.decode(ctx, json)
                
                case "DeleteArtifact" =>
                  Command.DeleteArtifact_JsonCodec.instance.decode(ctx, json)
                
                case "RotateExternalPassword" =>
                  Command.RotateExternalPassword_JsonCodec.instance.decode(ctx, json)
                
                case "GetExternalPassword" =>
                  Command.GetExternalPassword_JsonCodec.instance.decode(ctx, json)
                
                case "GetManifest" =>
                  Command.GetManifest_JsonCodec.instance.decode(ctx, json)
                
                case "GetUploadStatus" =>
                  Command.GetUploadStatus_JsonCodec.instance.decode(ctx, json)
                
                case "FinishUpload" =>
                  Command.FinishUpload_JsonCodec.instance.decode(ctx, json)
                
                case "CreateGrant" =>
                  Command.CreateGrant_JsonCodec.instance.decode(ctx, json)
                
                case "Search" =>
                  Command.Search_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Command: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Command: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Command: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Command.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Command.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Command.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Command]] = Lazy(Command_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Command]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Command] = LazyInstance.value
  }
}