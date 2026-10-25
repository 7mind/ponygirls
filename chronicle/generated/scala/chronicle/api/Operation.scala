import io.circe.Decoder.{decodeBoolean, decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import java.util.UUID

package chronicle.api {
  sealed trait Operation extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Operation.baboonDomainVersion
    override def baboonDomainIdentifier: String = Operation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Operation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Operation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Operation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Operation.baboonMinReaderVersions
  }
  
  object Operation {
    final case class Hello(
      versions: List[String]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Hello.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Hello.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Hello.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Hello.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Hello.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Hello.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Hello.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Hello.baboonAdtType
    }
    
    object Hello {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Hello"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Hello] = Operation.Hello_JsonCodec.instance
    }
    
    object Hello_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Hello, BaboonJsonCodec[Operation.Hello]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Hello): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "versions" -> Json.fromValues(value.versions.map(e => Json.fromString(e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Hello] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              versions <- getField(jsonObject, "versions").flatMap(v => decodeList(decodeString)(v.hcursor))
            } yield Operation.Hello(versions)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Hello: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Hello.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Hello.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Hello.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Hello.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Hello.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Hello]] = Lazy(Operation.Hello_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Hello]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Hello] = LazyInstance.value
    }
    
    
    final case class Ping(
      nonce: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Ping.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Ping.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Ping.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Ping.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Ping.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Ping.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Ping.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Ping.baboonAdtType
    }
    
    object Ping {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Ping"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Ping] = Operation.Ping_JsonCodec.instance
    }
    
    object Ping_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Ping, BaboonJsonCodec[Operation.Ping]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Ping): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "nonce" -> Json.fromString(value.nonce)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Ping] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              nonce <- getField(jsonObject, "nonce").flatMap(v => decodeString(v.hcursor))
            } yield Operation.Ping(nonce)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Ping: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Ping.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Ping.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Ping.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Ping.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Ping.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Ping]] = Lazy(Operation.Ping_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Ping]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Ping] = LazyInstance.value
    }
    
    
    final case class Pong(
      nonce: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Pong.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Pong.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Pong.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Pong.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Pong.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Pong.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Pong.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Pong.baboonAdtType
    }
    
    object Pong {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Pong"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Pong] = Operation.Pong_JsonCodec.instance
    }
    
    object Pong_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Pong, BaboonJsonCodec[Operation.Pong]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Pong): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "nonce" -> Json.fromString(value.nonce)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Pong] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              nonce <- getField(jsonObject, "nonce").flatMap(v => decodeString(v.hcursor))
            } yield Operation.Pong(nonce)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Pong: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Pong.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Pong.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Pong.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Pong.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Pong.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Pong]] = Lazy(Operation.Pong_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Pong]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Pong] = LazyInstance.value
    }
    
    
    final case class Whoami(
      
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Whoami.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Whoami.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Whoami.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Whoami.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Whoami.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Whoami.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Whoami.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Whoami.baboonAdtType
    }
    
    object Whoami {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Whoami"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Whoami] = Operation.Whoami_JsonCodec.instance
    }
    
    object Whoami_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Whoami, BaboonJsonCodec[Operation.Whoami]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Whoami): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Whoami] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Operation.Whoami())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Whoami: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Whoami.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Whoami.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Whoami.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Whoami.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Whoami.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Whoami]] = Lazy(Operation.Whoami_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Whoami]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Whoami] = LazyInstance.value
    }
    
    
    final case class Search(
      query: SearchQuery
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Search.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Search.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Search.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Search.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Search.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Search.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Search.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Search.baboonAdtType
    }
    
    object Search {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Search"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Search] = Operation.Search_JsonCodec.instance
    }
    
    object Search_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Search, BaboonJsonCodec[Operation.Search]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Search): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "query" -> SearchQuery_JsonCodec.instance.encode(ctx, value.query)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Search] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              query <- getField(jsonObject, "query").flatMap(v => SearchQuery_JsonCodec.circeDecoder(v.hcursor))
            } yield Operation.Search(query)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Search: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Search.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Search.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Search.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Search.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Search.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Search]] = Lazy(Operation.Search_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Search]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Search] = LazyInstance.value
    }
    
    
    final case class GetSession(
      sessionId: UUID,
      view: Option[ContentView]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.GetSession.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.GetSession.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.GetSession.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.GetSession.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.GetSession.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.GetSession.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.GetSession.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetSession.baboonAdtType
    }
    
    object GetSession {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#GetSession"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.GetSession] = Operation.GetSession_JsonCodec.instance
    }
    
    object GetSession_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.GetSession, BaboonJsonCodec[Operation.GetSession]] {
      def encode(ctx: BaboonCodecContext, value: Operation.GetSession): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString()),
          "view" -> value.view.map(v => ContentView_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.GetSession] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
              view <- getField(jsonObject, "view").flatMap(v => decodeOption(ContentView_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.GetSession(sessionId,view)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetSession: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.GetSession.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.GetSession.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.GetSession.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.GetSession.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetSession.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.GetSession]] = Lazy(Operation.GetSession_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.GetSession]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.GetSession] = LazyInstance.value
    }
    
    
    final case class GetChunks(
      sessionId: UUID,
      offset: Int,
      limit: Int,
      view: Option[ContentView]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.GetChunks.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.GetChunks.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.GetChunks.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.GetChunks.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.GetChunks.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.GetChunks.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.GetChunks.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetChunks.baboonAdtType
    }
    
    object GetChunks {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#GetChunks"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.GetChunks] = Operation.GetChunks_JsonCodec.instance
    }
    
    object GetChunks_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.GetChunks, BaboonJsonCodec[Operation.GetChunks]] {
      def encode(ctx: BaboonCodecContext, value: Operation.GetChunks): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString()),
          "offset" -> Json.fromInt(value.offset),
          "limit" -> Json.fromInt(value.limit),
          "view" -> value.view.map(v => ContentView_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.GetChunks] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
              offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              view <- getField(jsonObject, "view").flatMap(v => decodeOption(ContentView_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.GetChunks(sessionId,offset,limit,view)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetChunks: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.GetChunks.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.GetChunks.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.GetChunks.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.GetChunks.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetChunks.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.GetChunks]] = Lazy(Operation.GetChunks_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.GetChunks]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.GetChunks] = LazyInstance.value
    }
    
    
    final case class GetMessages(
      sessionId: UUID,
      offset: Int,
      limit: Int,
      view: Option[ContentView]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.GetMessages.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.GetMessages.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.GetMessages.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.GetMessages.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.GetMessages.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.GetMessages.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.GetMessages.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetMessages.baboonAdtType
    }
    
    object GetMessages {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#GetMessages"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.GetMessages] = Operation.GetMessages_JsonCodec.instance
    }
    
    object GetMessages_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.GetMessages, BaboonJsonCodec[Operation.GetMessages]] {
      def encode(ctx: BaboonCodecContext, value: Operation.GetMessages): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString()),
          "offset" -> Json.fromInt(value.offset),
          "limit" -> Json.fromInt(value.limit),
          "view" -> value.view.map(v => ContentView_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.GetMessages] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
              offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              view <- getField(jsonObject, "view").flatMap(v => decodeOption(ContentView_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.GetMessages(sessionId,offset,limit,view)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetMessages: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.GetMessages.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.GetMessages.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.GetMessages.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.GetMessages.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetMessages.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.GetMessages]] = Lazy(Operation.GetMessages_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.GetMessages]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.GetMessages] = LazyInstance.value
    }
    
    
    final case class GetRaw(
      sessionId: UUID,
      revision: Option[Int]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.GetRaw.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.GetRaw.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.GetRaw.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.GetRaw.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.GetRaw.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.GetRaw.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.GetRaw.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetRaw.baboonAdtType
    }
    
    object GetRaw {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#GetRaw"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.GetRaw] = Operation.GetRaw_JsonCodec.instance
    }
    
    object GetRaw_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.GetRaw, BaboonJsonCodec[Operation.GetRaw]] {
      def encode(ctx: BaboonCodecContext, value: Operation.GetRaw): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString()),
          "revision" -> value.revision.map(v => Json.fromInt(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.GetRaw] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
              revision <- getField(jsonObject, "revision").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            } yield Operation.GetRaw(sessionId,revision)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetRaw: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.GetRaw.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.GetRaw.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.GetRaw.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.GetRaw.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.GetRaw.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.GetRaw]] = Lazy(Operation.GetRaw_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.GetRaw]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.GetRaw] = LazyInstance.value
    }
    
    
    final case class Related(
      sessionId: UUID,
      limit: Int
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Related.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Related.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Related.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Related.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Related.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Related.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Related.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Related.baboonAdtType
    }
    
    object Related {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Related"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Related] = Operation.Related_JsonCodec.instance
    }
    
    object Related_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Related, BaboonJsonCodec[Operation.Related]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Related): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString()),
          "limit" -> Json.fromInt(value.limit)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Related] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
              limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            } yield Operation.Related(sessionId,limit)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Related: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Related.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Related.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Related.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Related.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Related.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Related]] = Lazy(Operation.Related_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Related]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Related] = LazyInstance.value
    }
    
    
    final case class Facets(
      filter: SearchFilter
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Facets.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Facets.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Facets.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Facets.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Facets.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Facets.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Facets.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Facets.baboonAdtType
    }
    
    object Facets {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Facets"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Facets] = Operation.Facets_JsonCodec.instance
    }
    
    object Facets_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Facets, BaboonJsonCodec[Operation.Facets]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Facets): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "filter" -> SearchFilter_JsonCodec.instance.encode(ctx, value.filter)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Facets] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              filter <- getField(jsonObject, "filter").flatMap(v => SearchFilter_JsonCodec.circeDecoder(v.hcursor))
            } yield Operation.Facets(filter)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Facets: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Facets.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Facets.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Facets.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Facets.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Facets.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Facets]] = Lazy(Operation.Facets_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Facets]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Facets] = LazyInstance.value
    }
    
    
    final case class IngestStatus(
      offset: Int,
      limit: Int
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.IngestStatus.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.IngestStatus.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.IngestStatus.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.IngestStatus.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.IngestStatus.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.IngestStatus.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.IngestStatus.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.IngestStatus.baboonAdtType
    }
    
    object IngestStatus {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#IngestStatus"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.IngestStatus] = Operation.IngestStatus_JsonCodec.instance
    }
    
    object IngestStatus_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.IngestStatus, BaboonJsonCodec[Operation.IngestStatus]] {
      def encode(ctx: BaboonCodecContext, value: Operation.IngestStatus): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "offset" -> Json.fromInt(value.offset),
          "limit" -> Json.fromInt(value.limit)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.IngestStatus] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
              limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            } yield Operation.IngestStatus(offset,limit)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to IngestStatus: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.IngestStatus.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.IngestStatus.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.IngestStatus.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.IngestStatus.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.IngestStatus.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.IngestStatus]] = Lazy(Operation.IngestStatus_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.IngestStatus]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.IngestStatus] = LazyInstance.value
    }
    
    
    final case class RetryJob(
      jobId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.RetryJob.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.RetryJob.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.RetryJob.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.RetryJob.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.RetryJob.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.RetryJob.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.RetryJob.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.RetryJob.baboonAdtType
    }
    
    object RetryJob {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#RetryJob"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.RetryJob] = Operation.RetryJob_JsonCodec.instance
    }
    
    object RetryJob_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.RetryJob, BaboonJsonCodec[Operation.RetryJob]] {
      def encode(ctx: BaboonCodecContext, value: Operation.RetryJob): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "jobId" -> Json.fromString(value.jobId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.RetryJob] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              jobId <- getField(jsonObject, "jobId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.RetryJob(jobId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetryJob: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.RetryJob.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.RetryJob.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.RetryJob.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.RetryJob.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.RetryJob.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.RetryJob]] = Lazy(Operation.RetryJob_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.RetryJob]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.RetryJob] = LazyInstance.value
    }
    
    
    final case class ListTokens(
      
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.ListTokens.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.ListTokens.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.ListTokens.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.ListTokens.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.ListTokens.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.ListTokens.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.ListTokens.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.ListTokens.baboonAdtType
    }
    
    object ListTokens {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#ListTokens"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.ListTokens] = Operation.ListTokens_JsonCodec.instance
    }
    
    object ListTokens_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.ListTokens, BaboonJsonCodec[Operation.ListTokens]] {
      def encode(ctx: BaboonCodecContext, value: Operation.ListTokens): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.ListTokens] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Operation.ListTokens())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ListTokens: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.ListTokens.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.ListTokens.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.ListTokens.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.ListTokens.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.ListTokens.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.ListTokens]] = Lazy(Operation.ListTokens_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.ListTokens]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.ListTokens] = LazyInstance.value
    }
    
    
    final case class MintToken(
      name: String,
      scopes: List[Scope]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.MintToken.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.MintToken.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.MintToken.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.MintToken.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.MintToken.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.MintToken.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.MintToken.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.MintToken.baboonAdtType
    }
    
    object MintToken {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#MintToken"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.MintToken] = Operation.MintToken_JsonCodec.instance
    }
    
    object MintToken_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.MintToken, BaboonJsonCodec[Operation.MintToken]] {
      def encode(ctx: BaboonCodecContext, value: Operation.MintToken): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "name" -> Json.fromString(value.name),
          "scopes" -> Json.fromValues(value.scopes.map(e => Scope_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.MintToken] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
              scopes <- getField(jsonObject, "scopes").flatMap(v => decodeList(Scope_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.MintToken(name,scopes)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to MintToken: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.MintToken.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.MintToken.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.MintToken.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.MintToken.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.MintToken.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.MintToken]] = Lazy(Operation.MintToken_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.MintToken]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.MintToken] = LazyInstance.value
    }
    
    
    final case class RevokeToken(
      tokenId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.RevokeToken.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.RevokeToken.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.RevokeToken.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.RevokeToken.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.RevokeToken.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.RevokeToken.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.RevokeToken.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.RevokeToken.baboonAdtType
    }
    
    object RevokeToken {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#RevokeToken"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.RevokeToken] = Operation.RevokeToken_JsonCodec.instance
    }
    
    object RevokeToken_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.RevokeToken, BaboonJsonCodec[Operation.RevokeToken]] {
      def encode(ctx: BaboonCodecContext, value: Operation.RevokeToken): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "tokenId" -> Json.fromString(value.tokenId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.RevokeToken] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              tokenId <- getField(jsonObject, "tokenId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.RevokeToken(tokenId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RevokeToken: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.RevokeToken.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.RevokeToken.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.RevokeToken.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.RevokeToken.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.RevokeToken.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.RevokeToken]] = Lazy(Operation.RevokeToken_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.RevokeToken]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.RevokeToken] = LazyInstance.value
    }
    
    
    final case class ListGroups(
      
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.ListGroups.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.ListGroups.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.ListGroups.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.ListGroups.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.ListGroups.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.ListGroups.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.ListGroups.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.ListGroups.baboonAdtType
    }
    
    object ListGroups {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#ListGroups"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.ListGroups] = Operation.ListGroups_JsonCodec.instance
    }
    
    object ListGroups_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.ListGroups, BaboonJsonCodec[Operation.ListGroups]] {
      def encode(ctx: BaboonCodecContext, value: Operation.ListGroups): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.ListGroups] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Operation.ListGroups())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ListGroups: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.ListGroups.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.ListGroups.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.ListGroups.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.ListGroups.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.ListGroups.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.ListGroups]] = Lazy(Operation.ListGroups_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.ListGroups]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.ListGroups] = LazyInstance.value
    }
    
    
    final case class CreateGroup(
      name: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.CreateGroup.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.CreateGroup.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.CreateGroup.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.CreateGroup.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.CreateGroup.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.CreateGroup.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.CreateGroup.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.CreateGroup.baboonAdtType
    }
    
    object CreateGroup {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#CreateGroup"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.CreateGroup] = Operation.CreateGroup_JsonCodec.instance
    }
    
    object CreateGroup_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.CreateGroup, BaboonJsonCodec[Operation.CreateGroup]] {
      def encode(ctx: BaboonCodecContext, value: Operation.CreateGroup): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "name" -> Json.fromString(value.name)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.CreateGroup] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            } yield Operation.CreateGroup(name)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to CreateGroup: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.CreateGroup.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.CreateGroup.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.CreateGroup.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.CreateGroup.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.CreateGroup.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.CreateGroup]] = Lazy(Operation.CreateGroup_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.CreateGroup]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.CreateGroup] = LazyInstance.value
    }
    
    
    final case class Invite(
      groupId: UUID,
      targetId: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Invite.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Invite.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Invite.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Invite.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Invite.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Invite.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Invite.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Invite.baboonAdtType
    }
    
    object Invite {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Invite"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Invite] = Operation.Invite_JsonCodec.instance
    }
    
    object Invite_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Invite, BaboonJsonCodec[Operation.Invite]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Invite): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "groupId" -> Json.fromString(value.groupId.toString()),
          "targetId" -> Json.fromString(value.targetId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Invite] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              groupId <- getField(jsonObject, "groupId").flatMap(v => decodeUUID(v.hcursor))
              targetId <- getField(jsonObject, "targetId").flatMap(v => decodeString(v.hcursor))
            } yield Operation.Invite(groupId,targetId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Invite: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Invite.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Invite.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Invite.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Invite.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Invite.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Invite]] = Lazy(Operation.Invite_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Invite]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Invite] = LazyInstance.value
    }
    
    
    final case class AcceptInvite(
      invitationId: UUID,
      confirmSharing: Boolean
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.AcceptInvite.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.AcceptInvite.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.AcceptInvite.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.AcceptInvite.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.AcceptInvite.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.AcceptInvite.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.AcceptInvite.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.AcceptInvite.baboonAdtType
    }
    
    object AcceptInvite {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.AcceptInvite] = Operation.AcceptInvite_JsonCodec.instance
    }
    
    object AcceptInvite_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.AcceptInvite, BaboonJsonCodec[Operation.AcceptInvite]] {
      def encode(ctx: BaboonCodecContext, value: Operation.AcceptInvite): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "invitationId" -> Json.fromString(value.invitationId.toString()),
          "confirmSharing" -> Json.fromBoolean(value.confirmSharing)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.AcceptInvite] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              invitationId <- getField(jsonObject, "invitationId").flatMap(v => decodeUUID(v.hcursor))
              confirmSharing <- getField(jsonObject, "confirmSharing").flatMap(v => decodeBoolean(v.hcursor))
            } yield Operation.AcceptInvite(invitationId,confirmSharing)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AcceptInvite: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.AcceptInvite.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.AcceptInvite.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.AcceptInvite.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.AcceptInvite.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.AcceptInvite.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.AcceptInvite]] = Lazy(Operation.AcceptInvite_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.AcceptInvite]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.AcceptInvite] = LazyInstance.value
    }
    
    
    final case class RemoveMember(
      groupId: UUID,
      userId: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.RemoveMember.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.RemoveMember.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.RemoveMember.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.RemoveMember.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.RemoveMember.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.RemoveMember.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.RemoveMember.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.RemoveMember.baboonAdtType
    }
    
    object RemoveMember {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#RemoveMember"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.RemoveMember] = Operation.RemoveMember_JsonCodec.instance
    }
    
    object RemoveMember_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.RemoveMember, BaboonJsonCodec[Operation.RemoveMember]] {
      def encode(ctx: BaboonCodecContext, value: Operation.RemoveMember): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "groupId" -> Json.fromString(value.groupId.toString()),
          "userId" -> Json.fromString(value.userId)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.RemoveMember] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              groupId <- getField(jsonObject, "groupId").flatMap(v => decodeUUID(v.hcursor))
              userId <- getField(jsonObject, "userId").flatMap(v => decodeString(v.hcursor))
            } yield Operation.RemoveMember(groupId,userId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RemoveMember: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.RemoveMember.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.RemoveMember.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.RemoveMember.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.RemoveMember.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.RemoveMember.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.RemoveMember]] = Lazy(Operation.RemoveMember_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.RemoveMember]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.RemoveMember] = LazyInstance.value
    }
    
    
    final case class LeaveGroup(
      groupId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.LeaveGroup.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.LeaveGroup.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.LeaveGroup.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.LeaveGroup.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.LeaveGroup.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.LeaveGroup.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.LeaveGroup.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.LeaveGroup.baboonAdtType
    }
    
    object LeaveGroup {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.LeaveGroup] = Operation.LeaveGroup_JsonCodec.instance
    }
    
    object LeaveGroup_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.LeaveGroup, BaboonJsonCodec[Operation.LeaveGroup]] {
      def encode(ctx: BaboonCodecContext, value: Operation.LeaveGroup): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "groupId" -> Json.fromString(value.groupId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.LeaveGroup] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              groupId <- getField(jsonObject, "groupId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.LeaveGroup(groupId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to LeaveGroup: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.LeaveGroup.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.LeaveGroup.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.LeaveGroup.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.LeaveGroup.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.LeaveGroup.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.LeaveGroup]] = Lazy(Operation.LeaveGroup_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.LeaveGroup]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.LeaveGroup] = LazyInstance.value
    }
    
    
    final case class DeleteGroup(
      groupId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.DeleteGroup.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.DeleteGroup.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.DeleteGroup.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.DeleteGroup.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.DeleteGroup.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.DeleteGroup.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.DeleteGroup.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.DeleteGroup.baboonAdtType
    }
    
    object DeleteGroup {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.DeleteGroup] = Operation.DeleteGroup_JsonCodec.instance
    }
    
    object DeleteGroup_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.DeleteGroup, BaboonJsonCodec[Operation.DeleteGroup]] {
      def encode(ctx: BaboonCodecContext, value: Operation.DeleteGroup): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "groupId" -> Json.fromString(value.groupId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.DeleteGroup] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              groupId <- getField(jsonObject, "groupId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.DeleteGroup(groupId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeleteGroup: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.DeleteGroup.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.DeleteGroup.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.DeleteGroup.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.DeleteGroup.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.DeleteGroup.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.DeleteGroup]] = Lazy(Operation.DeleteGroup_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.DeleteGroup]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.DeleteGroup] = LazyInstance.value
    }
    
    
    final case class Receipt(
      mutationId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Receipt.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Receipt.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Receipt.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Receipt.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Receipt.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Receipt.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Receipt.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Receipt.baboonAdtType
    }
    
    object Receipt {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Receipt"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Receipt] = Operation.Receipt_JsonCodec.instance
    }
    
    object Receipt_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Receipt, BaboonJsonCodec[Operation.Receipt]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Receipt): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "mutationId" -> Json.fromString(value.mutationId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Receipt] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              mutationId <- getField(jsonObject, "mutationId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.Receipt(mutationId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Receipt: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Receipt.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Receipt.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Receipt.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Receipt.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Receipt.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Receipt]] = Lazy(Operation.Receipt_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Receipt]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Receipt] = LazyInstance.value
    }
    
    
    final case class Purge(
      sessionId: UUID
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Purge.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Purge.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Purge.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Purge.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Purge.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Purge.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Purge.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Purge.baboonAdtType
    }
    
    object Purge {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Purge"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Purge] = Operation.Purge_JsonCodec.instance
    }
    
    object Purge_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Purge, BaboonJsonCodec[Operation.Purge]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Purge): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "sessionId" -> Json.fromString(value.sessionId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Purge] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            } yield Operation.Purge(sessionId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Purge: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Purge.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Purge.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Purge.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Purge.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Purge.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Purge]] = Lazy(Operation.Purge_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Purge]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Purge] = LazyInstance.value
    }
    
    
    final case class Logout(
      
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Logout.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Logout.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Logout.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Logout.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Logout.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Logout.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Logout.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Logout.baboonAdtType
    }
    
    object Logout {
      def baboonDomainVersion: String = "1.1.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#Operation]#Logout"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Logout] = Operation.Logout_JsonCodec.instance
    }
    
    object Logout_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Logout, BaboonJsonCodec[Operation.Logout]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Logout): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Logout] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(Operation.Logout())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Logout: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Logout.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Logout.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Logout.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Logout.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Logout.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Logout]] = Lazy(Operation.Logout_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Logout]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Logout] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Operation"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Operation] = Operation_JsonCodec.instance
  }
  
  object Operation_JsonCodec extends BaboonJsonCodec.BaseGenerated[Operation, BaboonJsonCodec[Operation]] {
    def encode(ctx: BaboonCodecContext, value: Operation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case hello: Operation.Hello => Json.obj("Hello" -> Operation.Hello_JsonCodec.instance.encode(ctx, hello))
        
        case ping: Operation.Ping => Json.obj("Ping" -> Operation.Ping_JsonCodec.instance.encode(ctx, ping))
        
        case pong: Operation.Pong => Json.obj("Pong" -> Operation.Pong_JsonCodec.instance.encode(ctx, pong))
        
        case whoami: Operation.Whoami => Json.obj("Whoami" -> Operation.Whoami_JsonCodec.instance.encode(ctx, whoami))
        
        case search: Operation.Search => Json.obj("Search" -> Operation.Search_JsonCodec.instance.encode(ctx, search))
        
        case getsession: Operation.GetSession => Json.obj("GetSession" -> Operation.GetSession_JsonCodec.instance.encode(ctx, getsession))
        
        case getchunks: Operation.GetChunks => Json.obj("GetChunks" -> Operation.GetChunks_JsonCodec.instance.encode(ctx, getchunks))
        
        case getmessages: Operation.GetMessages => Json.obj("GetMessages" -> Operation.GetMessages_JsonCodec.instance.encode(ctx, getmessages))
        
        case getraw: Operation.GetRaw => Json.obj("GetRaw" -> Operation.GetRaw_JsonCodec.instance.encode(ctx, getraw))
        
        case related: Operation.Related => Json.obj("Related" -> Operation.Related_JsonCodec.instance.encode(ctx, related))
        
        case facets: Operation.Facets => Json.obj("Facets" -> Operation.Facets_JsonCodec.instance.encode(ctx, facets))
        
        case ingeststatus: Operation.IngestStatus => Json.obj("IngestStatus" -> Operation.IngestStatus_JsonCodec.instance.encode(ctx, ingeststatus))
        
        case retryjob: Operation.RetryJob => Json.obj("RetryJob" -> Operation.RetryJob_JsonCodec.instance.encode(ctx, retryjob))
        
        case listtokens: Operation.ListTokens => Json.obj("ListTokens" -> Operation.ListTokens_JsonCodec.instance.encode(ctx, listtokens))
        
        case minttoken: Operation.MintToken => Json.obj("MintToken" -> Operation.MintToken_JsonCodec.instance.encode(ctx, minttoken))
        
        case revoketoken: Operation.RevokeToken => Json.obj("RevokeToken" -> Operation.RevokeToken_JsonCodec.instance.encode(ctx, revoketoken))
        
        case listgroups: Operation.ListGroups => Json.obj("ListGroups" -> Operation.ListGroups_JsonCodec.instance.encode(ctx, listgroups))
        
        case creategroup: Operation.CreateGroup => Json.obj("CreateGroup" -> Operation.CreateGroup_JsonCodec.instance.encode(ctx, creategroup))
        
        case invite: Operation.Invite => Json.obj("Invite" -> Operation.Invite_JsonCodec.instance.encode(ctx, invite))
        
        case acceptinvite: Operation.AcceptInvite => Json.obj("AcceptInvite" -> Operation.AcceptInvite_JsonCodec.instance.encode(ctx, acceptinvite))
        
        case removemember: Operation.RemoveMember => Json.obj("RemoveMember" -> Operation.RemoveMember_JsonCodec.instance.encode(ctx, removemember))
        
        case leavegroup: Operation.LeaveGroup => Json.obj("LeaveGroup" -> Operation.LeaveGroup_JsonCodec.instance.encode(ctx, leavegroup))
        
        case deletegroup: Operation.DeleteGroup => Json.obj("DeleteGroup" -> Operation.DeleteGroup_JsonCodec.instance.encode(ctx, deletegroup))
        
        case receipt: Operation.Receipt => Json.obj("Receipt" -> Operation.Receipt_JsonCodec.instance.encode(ctx, receipt))
        
        case purge: Operation.Purge => Json.obj("Purge" -> Operation.Purge_JsonCodec.instance.encode(ctx, purge))
        
        case logout: Operation.Logout => Json.obj("Logout" -> Operation.Logout_JsonCodec.instance.encode(ctx, logout))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Hello" =>
                  Operation.Hello_JsonCodec.instance.decode(ctx, json)
                
                case "Ping" =>
                  Operation.Ping_JsonCodec.instance.decode(ctx, json)
                
                case "Pong" =>
                  Operation.Pong_JsonCodec.instance.decode(ctx, json)
                
                case "Whoami" =>
                  Operation.Whoami_JsonCodec.instance.decode(ctx, json)
                
                case "Search" =>
                  Operation.Search_JsonCodec.instance.decode(ctx, json)
                
                case "GetSession" =>
                  Operation.GetSession_JsonCodec.instance.decode(ctx, json)
                
                case "GetChunks" =>
                  Operation.GetChunks_JsonCodec.instance.decode(ctx, json)
                
                case "GetMessages" =>
                  Operation.GetMessages_JsonCodec.instance.decode(ctx, json)
                
                case "GetRaw" =>
                  Operation.GetRaw_JsonCodec.instance.decode(ctx, json)
                
                case "Related" =>
                  Operation.Related_JsonCodec.instance.decode(ctx, json)
                
                case "Facets" =>
                  Operation.Facets_JsonCodec.instance.decode(ctx, json)
                
                case "IngestStatus" =>
                  Operation.IngestStatus_JsonCodec.instance.decode(ctx, json)
                
                case "RetryJob" =>
                  Operation.RetryJob_JsonCodec.instance.decode(ctx, json)
                
                case "ListTokens" =>
                  Operation.ListTokens_JsonCodec.instance.decode(ctx, json)
                
                case "MintToken" =>
                  Operation.MintToken_JsonCodec.instance.decode(ctx, json)
                
                case "RevokeToken" =>
                  Operation.RevokeToken_JsonCodec.instance.decode(ctx, json)
                
                case "ListGroups" =>
                  Operation.ListGroups_JsonCodec.instance.decode(ctx, json)
                
                case "CreateGroup" =>
                  Operation.CreateGroup_JsonCodec.instance.decode(ctx, json)
                
                case "Invite" =>
                  Operation.Invite_JsonCodec.instance.decode(ctx, json)
                
                case "AcceptInvite" =>
                  Operation.AcceptInvite_JsonCodec.instance.decode(ctx, json)
                
                case "RemoveMember" =>
                  Operation.RemoveMember_JsonCodec.instance.decode(ctx, json)
                
                case "LeaveGroup" =>
                  Operation.LeaveGroup_JsonCodec.instance.decode(ctx, json)
                
                case "DeleteGroup" =>
                  Operation.DeleteGroup_JsonCodec.instance.decode(ctx, json)
                
                case "Receipt" =>
                  Operation.Receipt_JsonCodec.instance.decode(ctx, json)
                
                case "Purge" =>
                  Operation.Purge_JsonCodec.instance.decode(ctx, json)
                
                case "Logout" =>
                  Operation.Logout_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Operation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Operation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Operation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation]] = Lazy(Operation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Operation] = LazyInstance.value
  }
}