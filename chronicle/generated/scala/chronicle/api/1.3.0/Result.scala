import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGenerated, Lazy}
import io.circe.Decoder.decodeString


package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  sealed trait Result extends BaboonGenerated {
    override def baboonDomainVersion: String = Result.baboonDomainVersion
    override def baboonDomainIdentifier: String = Result.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Result.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Result.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Result.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Result.baboonMinReaderVersions
  }
  
  object Result {
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Hello(
      versions: VersionInfo,
      user: UserInfo
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Hello.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Hello.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Hello.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Hello.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Hello.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Hello.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Hello.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Hello.baboonAdtType
    }
    
    object Hello {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Hello"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Hello] = Result.Hello_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Hello_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Hello, BaboonJsonCodec[Result.Hello]] {
      def encode(ctx: BaboonCodecContext, value: Result.Hello): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "versions" -> VersionInfo_JsonCodec.instance.encode(ctx, value.versions),
          "user" -> UserInfo_JsonCodec.instance.encode(ctx, value.user)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Hello] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              versions <- getField(jsonObject, "versions").flatMap(v => VersionInfo_JsonCodec.circeDecoder(v.hcursor))
              user <- getField(jsonObject, "user").flatMap(v => UserInfo_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Hello(versions,user)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Hello: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Hello.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Hello.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Hello.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Hello.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Hello.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Hello]] = Lazy(Result.Hello_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Hello]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Hello] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Pong(
      nonce: String
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Pong.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Pong.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Pong.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Pong.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Pong.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Pong.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Pong.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Pong.baboonAdtType
    }
    
    object Pong {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Pong"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Pong] = Result.Pong_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Pong_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Pong, BaboonJsonCodec[Result.Pong]] {
      def encode(ctx: BaboonCodecContext, value: Result.Pong): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "nonce" -> Json.fromString(value.nonce)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Pong] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              nonce <- getField(jsonObject, "nonce").flatMap(v => decodeString(v.hcursor))
            } yield Result.Pong(nonce)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Pong: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Pong.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Pong.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Pong.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Pong.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Pong.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Pong]] = Lazy(Result.Pong_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Pong]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Pong] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Whoami(
      user: UserInfo
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Whoami.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Whoami.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Whoami.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Whoami.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Whoami.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Whoami.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Whoami.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Whoami.baboonAdtType
    }
    
    object Whoami {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Whoami"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Whoami] = Result.Whoami_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Whoami_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Whoami, BaboonJsonCodec[Result.Whoami]] {
      def encode(ctx: BaboonCodecContext, value: Result.Whoami): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "user" -> UserInfo_JsonCodec.instance.encode(ctx, value.user)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Whoami] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              user <- getField(jsonObject, "user").flatMap(v => UserInfo_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Whoami(user)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Whoami: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Whoami.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Whoami.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Whoami.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Whoami.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Whoami.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Whoami]] = Lazy(Result.Whoami_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Whoami]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Whoami] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Search(
      result: SearchResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Search.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Search.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Search.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Search.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Search.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Search.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Search.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Search.baboonAdtType
    }
    
    object Search {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Search"
      private lazy val _baboonSameInVersions: List[String] = List("1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.1.0", "prefix-any-mode" -> "1.1.0", "identical" -> "1.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Search] = Result.Search_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Search_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Search, BaboonJsonCodec[Result.Search]] {
      def encode(ctx: BaboonCodecContext, value: Result.Search): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> SearchResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Search] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => SearchResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Search(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Search: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Search.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Search.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Search.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Search.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Search.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Search]] = Lazy(Result.Search_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Search]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Search] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Session(
      result: SessionResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Session.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Session.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Session.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Session.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Session.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Session.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Session.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Session.baboonAdtType
    }
    
    object Session {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Session"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Session] = Result.Session_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Session_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Session, BaboonJsonCodec[Result.Session]] {
      def encode(ctx: BaboonCodecContext, value: Result.Session): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> SessionResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Session] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => SessionResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Session(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Session: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Session.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Session.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Session.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Session.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Session.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Session]] = Lazy(Result.Session_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Session]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Session] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Chunks(
      result: ChunksResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Chunks.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Chunks.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Chunks.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Chunks.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Chunks.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Chunks.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Chunks.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Chunks.baboonAdtType
    }
    
    object Chunks {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Chunks"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Chunks] = Result.Chunks_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Chunks_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Chunks, BaboonJsonCodec[Result.Chunks]] {
      def encode(ctx: BaboonCodecContext, value: Result.Chunks): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> ChunksResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Chunks] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => ChunksResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Chunks(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Chunks: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Chunks.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Chunks.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Chunks.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Chunks.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Chunks.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Chunks]] = Lazy(Result.Chunks_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Chunks]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Chunks] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Messages(
      result: MessagesResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Messages.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Messages.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Messages.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Messages.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Messages.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Messages.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Messages.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Messages.baboonAdtType
    }
    
    object Messages {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Messages"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Messages] = Result.Messages_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Messages_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Messages, BaboonJsonCodec[Result.Messages]] {
      def encode(ctx: BaboonCodecContext, value: Result.Messages): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> MessagesResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Messages] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => MessagesResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Messages(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Messages: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Messages.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Messages.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Messages.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Messages.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Messages.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Messages]] = Lazy(Result.Messages_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Messages]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Messages] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Raw(
      result: RawResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Raw.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Raw.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Raw.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Raw.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Raw.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Raw.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Raw.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Raw.baboonAdtType
    }
    
    object Raw {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Raw"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Raw] = Result.Raw_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Raw_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Raw, BaboonJsonCodec[Result.Raw]] {
      def encode(ctx: BaboonCodecContext, value: Result.Raw): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> RawResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Raw] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => RawResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Raw(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Raw: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Raw.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Raw.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Raw.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Raw.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Raw.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Raw]] = Lazy(Result.Raw_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Raw]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Raw] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Related(
      result: RelatedResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Related.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Related.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Related.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Related.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Related.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Related.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Related.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Related.baboonAdtType
    }
    
    object Related {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Related"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Related] = Result.Related_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Related_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Related, BaboonJsonCodec[Result.Related]] {
      def encode(ctx: BaboonCodecContext, value: Result.Related): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> RelatedResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Related] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => RelatedResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Related(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Related: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Related.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Related.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Related.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Related.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Related.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Related]] = Lazy(Result.Related_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Related]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Related] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Facets(
      result: FacetsResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Facets.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Facets.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Facets.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Facets.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Facets.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Facets.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Facets.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Facets.baboonAdtType
    }
    
    object Facets {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Facets"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Facets] = Result.Facets_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Facets_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Facets, BaboonJsonCodec[Result.Facets]] {
      def encode(ctx: BaboonCodecContext, value: Result.Facets): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> FacetsResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Facets] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => FacetsResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Facets(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Facets: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Facets.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Facets.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Facets.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Facets.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Facets.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Facets]] = Lazy(Result.Facets_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Facets]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Facets] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class CollectionStatus(
      result: CollectorStatusResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.CollectionStatus.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.CollectionStatus.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.CollectionStatus.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.CollectionStatus.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.CollectionStatus.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.CollectionStatus.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.CollectionStatus.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.CollectionStatus.baboonAdtType
    }
    
    object CollectionStatus {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#CollectionStatus"
      private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.CollectionStatus] = Result.CollectionStatus_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object CollectionStatus_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.CollectionStatus, BaboonJsonCodec[Result.CollectionStatus]] {
      def encode(ctx: BaboonCodecContext, value: Result.CollectionStatus): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> CollectorStatusResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.CollectionStatus] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => CollectorStatusResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.CollectionStatus(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectionStatus: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.CollectionStatus.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.CollectionStatus.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.CollectionStatus.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.CollectionStatus.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.CollectionStatus.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.CollectionStatus]] = Lazy(Result.CollectionStatus_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.CollectionStatus]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.CollectionStatus] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Status(
      result: StatusResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Status.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Status.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Status.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Status.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Status.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Status.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Status.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Status.baboonAdtType
    }
    
    object Status {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Status"
      private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "json-additive", "1.8.0" -> "json-additive")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Status] = Result.Status_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Status_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Status, BaboonJsonCodec[Result.Status]] {
      def encode(ctx: BaboonCodecContext, value: Result.Status): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> StatusResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Status] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => StatusResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Status(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Status: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Status.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Status.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Status.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Status.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Status.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Status]] = Lazy(Result.Status_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Status]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Status] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Tokens(
      result: TokensResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Tokens.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Tokens.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Tokens.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Tokens.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Tokens.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Tokens.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Tokens.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Tokens.baboonAdtType
    }
    
    object Tokens {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Tokens"
      private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Tokens] = Result.Tokens_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Tokens_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Tokens, BaboonJsonCodec[Result.Tokens]] {
      def encode(ctx: BaboonCodecContext, value: Result.Tokens): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> TokensResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Tokens] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => TokensResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Tokens(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Tokens: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Tokens.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Tokens.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Tokens.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Tokens.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Tokens.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Tokens]] = Lazy(Result.Tokens_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Tokens]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Tokens] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Token(
      result: TokenResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Token.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Token.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Token.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Token.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Token.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Token.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Token.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Token.baboonAdtType
    }
    
    object Token {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Token"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Token] = Result.Token_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Token_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Token, BaboonJsonCodec[Result.Token]] {
      def encode(ctx: BaboonCodecContext, value: Result.Token): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> TokenResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Token] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => TokenResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Token(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Token: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Token.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Token.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Token.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Token.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Token.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Token]] = Lazy(Result.Token_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Token]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Token] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Groups(
      result: GroupsResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Groups.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Groups.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Groups.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Groups.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Groups.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Groups.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Groups.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Groups.baboonAdtType
    }
    
    object Groups {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Groups"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Groups] = Result.Groups_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Groups_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Groups, BaboonJsonCodec[Result.Groups]] {
      def encode(ctx: BaboonCodecContext, value: Result.Groups): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> GroupsResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Groups] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => GroupsResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Groups(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Groups: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Groups.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Groups.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Groups.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Groups.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Groups.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Groups]] = Lazy(Result.Groups_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Groups]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Groups] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Mutation(
      receipt: MutationReceipt
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Mutation.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Mutation.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Mutation.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Mutation.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Mutation.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Mutation.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Mutation.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Mutation.baboonAdtType
    }
    
    object Mutation {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Mutation"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Mutation] = Result.Mutation_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Mutation_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Mutation, BaboonJsonCodec[Result.Mutation]] {
      def encode(ctx: BaboonCodecContext, value: Result.Mutation): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "receipt" -> MutationReceipt_JsonCodec.instance.encode(ctx, value.receipt)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Mutation] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              receipt <- getField(jsonObject, "receipt").flatMap(v => MutationReceipt_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Mutation(receipt)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Mutation: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Mutation.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Mutation.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Mutation.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Mutation.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Mutation.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Mutation]] = Lazy(Result.Mutation_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Mutation]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Mutation] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Error(
      failure: Failure
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
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
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Error"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Error] = Result.Error_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
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
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Ping(
      nonce: String
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Ping.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Ping.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Ping.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Ping.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Ping.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Ping.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Ping.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Ping.baboonAdtType
    }
    
    object Ping {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Ping"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Ping] = Result.Ping_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Ping_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Ping, BaboonJsonCodec[Result.Ping]] {
      def encode(ctx: BaboonCodecContext, value: Result.Ping): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "nonce" -> Json.fromString(value.nonce)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Ping] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              nonce <- getField(jsonObject, "nonce").flatMap(v => decodeString(v.hcursor))
            } yield Result.Ping(nonce)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Ping: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Ping.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Ping.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Ping.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Ping.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Ping.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Ping]] = Lazy(Result.Ping_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Ping]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Ping] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Archive(
      result: ArchiveResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Archive.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Archive.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Archive.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Archive.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Archive.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Archive.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Archive.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Archive.baboonAdtType
    }
    
    object Archive {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Archive"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "json-additive", "1.6.0" -> "json-additive")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Archive] = Result.Archive_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Archive_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Archive, BaboonJsonCodec[Result.Archive]] {
      def encode(ctx: BaboonCodecContext, value: Result.Archive): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> ArchiveResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Archive] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => ArchiveResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Archive(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Archive: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Archive.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Archive.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Archive.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Archive.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Archive.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Archive]] = Lazy(Result.Archive_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Archive]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Archive] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class Activity(
      result: ActivityResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.Activity.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.Activity.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.Activity.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.Activity.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.Activity.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.Activity.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.Activity.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.Activity.baboonAdtType
    }
    
    object Activity {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#Activity"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.Activity] = Result.Activity_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object Activity_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.Activity, BaboonJsonCodec[Result.Activity]] {
      def encode(ctx: BaboonCodecContext, value: Result.Activity): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> ActivityResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.Activity] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => ActivityResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.Activity(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Activity: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.Activity.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.Activity.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.Activity.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.Activity.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.Activity.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.Activity]] = Lazy(Result.Activity_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.Activity]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.Activity] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class ActivityJobs(
      result: ActivityJobsResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.ActivityJobs.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.ActivityJobs.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.ActivityJobs.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.ActivityJobs.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.ActivityJobs.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.ActivityJobs.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.ActivityJobs.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.ActivityJobs.baboonAdtType
    }
    
    object ActivityJobs {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#ActivityJobs"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "json-additive", "1.8.0" -> "json-additive")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.ActivityJobs] = Result.ActivityJobs_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object ActivityJobs_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.ActivityJobs, BaboonJsonCodec[Result.ActivityJobs]] {
      def encode(ctx: BaboonCodecContext, value: Result.ActivityJobs): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> ActivityJobsResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.ActivityJobs] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => ActivityJobsResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.ActivityJobs(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJobs: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.ActivityJobs.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.ActivityJobs.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.ActivityJobs.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.ActivityJobs.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.ActivityJobs.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.ActivityJobs]] = Lazy(Result.ActivityJobs_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.ActivityJobs]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.ActivityJobs] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class LocatedMessage(
      result: MessageLocation
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.LocatedMessage.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.LocatedMessage.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.LocatedMessage.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.LocatedMessage.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.LocatedMessage.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.LocatedMessage.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.LocatedMessage.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.LocatedMessage.baboonAdtType
    }
    
    object LocatedMessage {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#LocatedMessage"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.LocatedMessage] = Result.LocatedMessage_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object LocatedMessage_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.LocatedMessage, BaboonJsonCodec[Result.LocatedMessage]] {
      def encode(ctx: BaboonCodecContext, value: Result.LocatedMessage): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> MessageLocation_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.LocatedMessage] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => MessageLocation_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.LocatedMessage(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to LocatedMessage: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.LocatedMessage.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.LocatedMessage.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.LocatedMessage.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.LocatedMessage.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.LocatedMessage.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.LocatedMessage]] = Lazy(Result.LocatedMessage_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.LocatedMessage]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.LocatedMessage] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class RetryFailedPreview(
      result: RetryFailedPlan
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.RetryFailedPreview.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.RetryFailedPreview.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.RetryFailedPreview.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.RetryFailedPreview.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.RetryFailedPreview.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.RetryFailedPreview.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.RetryFailedPreview.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.RetryFailedPreview.baboonAdtType
    }
    
    object RetryFailedPreview {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.RetryFailedPreview] = Result.RetryFailedPreview_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object RetryFailedPreview_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.RetryFailedPreview, BaboonJsonCodec[Result.RetryFailedPreview]] {
      def encode(ctx: BaboonCodecContext, value: Result.RetryFailedPreview): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> RetryFailedPlan_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.RetryFailedPreview] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => RetryFailedPlan_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.RetryFailedPreview(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryFailedPreview: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.RetryFailedPreview.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.RetryFailedPreview.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.RetryFailedPreview.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.RetryFailedPreview.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.RetryFailedPreview.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.RetryFailedPreview]] = Lazy(Result.RetryFailedPreview_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.RetryFailedPreview]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.RetryFailedPreview] = LazyInstance.value
    }
    
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    final case class RetryFailed(
      result: RetryFailedResult
    ) extends Result with BaboonAdtMemberMeta with BaboonGenerated {
      override def baboonDomainVersion: String = Result.RetryFailed.baboonDomainVersion
      override def baboonDomainIdentifier: String = Result.RetryFailed.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Result.RetryFailed.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Result.RetryFailed.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Result.RetryFailed.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Result.RetryFailed.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Result.RetryFailed.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Result.RetryFailed.baboonAdtType
    }
    
    object RetryFailed {
      def baboonDomainVersion: String = "1.3.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Result]#RetryFailed"
      private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Result"
      def baboonAdtType: _root_.java.lang.Class[?] = Result.getClass
      @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result.RetryFailed] = Result.RetryFailed_JsonCodec.instance
    }
    
    @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
    object RetryFailed_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Result.RetryFailed, BaboonJsonCodec[Result.RetryFailed]] {
      def encode(ctx: BaboonCodecContext, value: Result.RetryFailed): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "result" -> RetryFailedResult_JsonCodec.instance.encode(ctx, value.result)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Result.RetryFailed] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              result <- getField(jsonObject, "result").flatMap(v => RetryFailedResult_JsonCodec.circeDecoder(v.hcursor))
            } yield Result.RetryFailed(result)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryFailed: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Result.RetryFailed.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Result.RetryFailed.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Result.RetryFailed.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Result.RetryFailed.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Result.RetryFailed.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Result.RetryFailed]] = Lazy(Result.RetryFailed_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Result.RetryFailed]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Result.RetryFailed] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Result"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Result] = Result_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  object Result_JsonCodec extends BaboonJsonCodec.BaseGenerated[Result, BaboonJsonCodec[Result]] {
    def encode(ctx: BaboonCodecContext, value: Result): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case hello: Result.Hello => Json.obj("Hello" -> Result.Hello_JsonCodec.instance.encode(ctx, hello))
        
        case pong: Result.Pong => Json.obj("Pong" -> Result.Pong_JsonCodec.instance.encode(ctx, pong))
        
        case whoami: Result.Whoami => Json.obj("Whoami" -> Result.Whoami_JsonCodec.instance.encode(ctx, whoami))
        
        case search: Result.Search => Json.obj("Search" -> Result.Search_JsonCodec.instance.encode(ctx, search))
        
        case session: Result.Session => Json.obj("Session" -> Result.Session_JsonCodec.instance.encode(ctx, session))
        
        case chunks: Result.Chunks => Json.obj("Chunks" -> Result.Chunks_JsonCodec.instance.encode(ctx, chunks))
        
        case messages: Result.Messages => Json.obj("Messages" -> Result.Messages_JsonCodec.instance.encode(ctx, messages))
        
        case raw: Result.Raw => Json.obj("Raw" -> Result.Raw_JsonCodec.instance.encode(ctx, raw))
        
        case related: Result.Related => Json.obj("Related" -> Result.Related_JsonCodec.instance.encode(ctx, related))
        
        case facets: Result.Facets => Json.obj("Facets" -> Result.Facets_JsonCodec.instance.encode(ctx, facets))
        
        case collectionstatus: Result.CollectionStatus => Json.obj("CollectionStatus" -> Result.CollectionStatus_JsonCodec.instance.encode(ctx, collectionstatus))
        
        case status: Result.Status => Json.obj("Status" -> Result.Status_JsonCodec.instance.encode(ctx, status))
        
        case tokens: Result.Tokens => Json.obj("Tokens" -> Result.Tokens_JsonCodec.instance.encode(ctx, tokens))
        
        case token: Result.Token => Json.obj("Token" -> Result.Token_JsonCodec.instance.encode(ctx, token))
        
        case groups: Result.Groups => Json.obj("Groups" -> Result.Groups_JsonCodec.instance.encode(ctx, groups))
        
        case mutation: Result.Mutation => Json.obj("Mutation" -> Result.Mutation_JsonCodec.instance.encode(ctx, mutation))
        
        case error: Result.Error => Json.obj("Error" -> Result.Error_JsonCodec.instance.encode(ctx, error))
        
        case ping: Result.Ping => Json.obj("Ping" -> Result.Ping_JsonCodec.instance.encode(ctx, ping))
        
        case archive: Result.Archive => Json.obj("Archive" -> Result.Archive_JsonCodec.instance.encode(ctx, archive))
        
        case activity: Result.Activity => Json.obj("Activity" -> Result.Activity_JsonCodec.instance.encode(ctx, activity))
        
        case activityjobs: Result.ActivityJobs => Json.obj("ActivityJobs" -> Result.ActivityJobs_JsonCodec.instance.encode(ctx, activityjobs))
        
        case locatedmessage: Result.LocatedMessage => Json.obj("LocatedMessage" -> Result.LocatedMessage_JsonCodec.instance.encode(ctx, locatedmessage))
        
        case retryfailedpreview: Result.RetryFailedPreview => Json.obj("RetryFailedPreview" -> Result.RetryFailedPreview_JsonCodec.instance.encode(ctx, retryfailedpreview))
        
        case retryfailed: Result.RetryFailed => Json.obj("RetryFailed" -> Result.RetryFailed_JsonCodec.instance.encode(ctx, retryfailed))
      
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
                case "Hello" =>
                  Result.Hello_JsonCodec.instance.decode(ctx, json)
                
                case "Pong" =>
                  Result.Pong_JsonCodec.instance.decode(ctx, json)
                
                case "Whoami" =>
                  Result.Whoami_JsonCodec.instance.decode(ctx, json)
                
                case "Search" =>
                  Result.Search_JsonCodec.instance.decode(ctx, json)
                
                case "Session" =>
                  Result.Session_JsonCodec.instance.decode(ctx, json)
                
                case "Chunks" =>
                  Result.Chunks_JsonCodec.instance.decode(ctx, json)
                
                case "Messages" =>
                  Result.Messages_JsonCodec.instance.decode(ctx, json)
                
                case "Raw" =>
                  Result.Raw_JsonCodec.instance.decode(ctx, json)
                
                case "Related" =>
                  Result.Related_JsonCodec.instance.decode(ctx, json)
                
                case "Facets" =>
                  Result.Facets_JsonCodec.instance.decode(ctx, json)
                
                case "CollectionStatus" =>
                  Result.CollectionStatus_JsonCodec.instance.decode(ctx, json)
                
                case "Status" =>
                  Result.Status_JsonCodec.instance.decode(ctx, json)
                
                case "Tokens" =>
                  Result.Tokens_JsonCodec.instance.decode(ctx, json)
                
                case "Token" =>
                  Result.Token_JsonCodec.instance.decode(ctx, json)
                
                case "Groups" =>
                  Result.Groups_JsonCodec.instance.decode(ctx, json)
                
                case "Mutation" =>
                  Result.Mutation_JsonCodec.instance.decode(ctx, json)
                
                case "Error" =>
                  Result.Error_JsonCodec.instance.decode(ctx, json)
                
                case "Ping" =>
                  Result.Ping_JsonCodec.instance.decode(ctx, json)
                
                case "Archive" =>
                  Result.Archive_JsonCodec.instance.decode(ctx, json)
                
                case "Activity" =>
                  Result.Activity_JsonCodec.instance.decode(ctx, json)
                
                case "ActivityJobs" =>
                  Result.ActivityJobs_JsonCodec.instance.decode(ctx, json)
                
                case "LocatedMessage" =>
                  Result.LocatedMessage_JsonCodec.instance.decode(ctx, json)
                
                case "RetryFailedPreview" =>
                  Result.RetryFailedPreview_JsonCodec.instance.decode(ctx, json)
                
                case "RetryFailed" =>
                  Result.RetryFailed_JsonCodec.instance.decode(ctx, json)
      
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