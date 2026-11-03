import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package manure.api {
  sealed trait ContentCommand extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContentCommand.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContentCommand.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContentCommand.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContentCommand.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContentCommand.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContentCommand.baboonMinReaderVersions
  }
  
  object ContentCommand {
    final case class Unlock(
      password: String
    ) extends ContentCommand with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentCommand.Unlock.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentCommand.Unlock.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentCommand.Unlock.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentCommand.Unlock.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentCommand.Unlock.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentCommand.Unlock.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentCommand.Unlock.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.Unlock.baboonAdtType
    }
    
    object Unlock {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ContentCommand]#Unlock"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ContentCommand"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.getClass
      def codecJson: BaboonJsonCodec[ContentCommand.Unlock] = ContentCommand.Unlock_JsonCodec.instance
    }
    
    object Unlock_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentCommand.Unlock, BaboonJsonCodec[ContentCommand.Unlock]] {
      def encode(ctx: BaboonCodecContext, value: ContentCommand.Unlock): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "password" -> Json.fromString(value.password)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentCommand.Unlock] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              password <- getField(jsonObject, "password").flatMap(v => decodeString(v.hcursor))
            } yield ContentCommand.Unlock(password)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Unlock: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentCommand.Unlock.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentCommand.Unlock.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentCommand.Unlock.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentCommand.Unlock.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.Unlock.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentCommand.Unlock]] = Lazy(ContentCommand.Unlock_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentCommand.Unlock]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentCommand.Unlock] = LazyInstance.value
    }
    
    
    final case class RedeemGrant(
      grant: String
    ) extends ContentCommand with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentCommand.RedeemGrant.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentCommand.RedeemGrant.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentCommand.RedeemGrant.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentCommand.RedeemGrant.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentCommand.RedeemGrant.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentCommand.RedeemGrant.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentCommand.RedeemGrant.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.RedeemGrant.baboonAdtType
    }
    
    object RedeemGrant {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ContentCommand]#RedeemGrant"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ContentCommand"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.getClass
      def codecJson: BaboonJsonCodec[ContentCommand.RedeemGrant] = ContentCommand.RedeemGrant_JsonCodec.instance
    }
    
    object RedeemGrant_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentCommand.RedeemGrant, BaboonJsonCodec[ContentCommand.RedeemGrant]] {
      def encode(ctx: BaboonCodecContext, value: ContentCommand.RedeemGrant): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "grant" -> Json.fromString(value.grant)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentCommand.RedeemGrant] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              grant <- getField(jsonObject, "grant").flatMap(v => decodeString(v.hcursor))
            } yield ContentCommand.RedeemGrant(grant)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RedeemGrant: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentCommand.RedeemGrant.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentCommand.RedeemGrant.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentCommand.RedeemGrant.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentCommand.RedeemGrant.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.RedeemGrant.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentCommand.RedeemGrant]] = Lazy(ContentCommand.RedeemGrant_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentCommand.RedeemGrant]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentCommand.RedeemGrant] = LazyInstance.value
    }
    
    
    final case class Logout(
      
    ) extends ContentCommand with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentCommand.Logout.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentCommand.Logout.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentCommand.Logout.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentCommand.Logout.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentCommand.Logout.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentCommand.Logout.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentCommand.Logout.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.Logout.baboonAdtType
    }
    
    object Logout {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ContentCommand]#Logout"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ContentCommand"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.getClass
      def codecJson: BaboonJsonCodec[ContentCommand.Logout] = ContentCommand.Logout_JsonCodec.instance
    }
    
    object Logout_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentCommand.Logout, BaboonJsonCodec[ContentCommand.Logout]] {
      def encode(ctx: BaboonCodecContext, value: ContentCommand.Logout): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentCommand.Logout] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ContentCommand.Logout())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Logout: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentCommand.Logout.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentCommand.Logout.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentCommand.Logout.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentCommand.Logout.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.Logout.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentCommand.Logout]] = Lazy(ContentCommand.Logout_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentCommand.Logout]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentCommand.Logout] = LazyInstance.value
    }
    
    
    final case class GetManifest(
      
    ) extends ContentCommand with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentCommand.GetManifest.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentCommand.GetManifest.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentCommand.GetManifest.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentCommand.GetManifest.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentCommand.GetManifest.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentCommand.GetManifest.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentCommand.GetManifest.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.GetManifest.baboonAdtType
    }
    
    object GetManifest {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ContentCommand]#GetManifest"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ContentCommand"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.getClass
      def codecJson: BaboonJsonCodec[ContentCommand.GetManifest] = ContentCommand.GetManifest_JsonCodec.instance
    }
    
    object GetManifest_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentCommand.GetManifest, BaboonJsonCodec[ContentCommand.GetManifest]] {
      def encode(ctx: BaboonCodecContext, value: ContentCommand.GetManifest): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentCommand.GetManifest] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ContentCommand.GetManifest())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to GetManifest: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentCommand.GetManifest.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentCommand.GetManifest.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentCommand.GetManifest.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentCommand.GetManifest.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentCommand.GetManifest.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentCommand.GetManifest]] = Lazy(ContentCommand.GetManifest_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentCommand.GetManifest]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentCommand.GetManifest] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ContentCommand"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContentCommand] = ContentCommand_JsonCodec.instance
  }
  
  object ContentCommand_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContentCommand, BaboonJsonCodec[ContentCommand]] {
    def encode(ctx: BaboonCodecContext, value: ContentCommand): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case unlock: ContentCommand.Unlock => Json.obj("Unlock" -> ContentCommand.Unlock_JsonCodec.instance.encode(ctx, unlock))
        
        case redeemgrant: ContentCommand.RedeemGrant => Json.obj("RedeemGrant" -> ContentCommand.RedeemGrant_JsonCodec.instance.encode(ctx, redeemgrant))
        
        case logout: ContentCommand.Logout => Json.obj("Logout" -> ContentCommand.Logout_JsonCodec.instance.encode(ctx, logout))
        
        case getmanifest: ContentCommand.GetManifest => Json.obj("GetManifest" -> ContentCommand.GetManifest_JsonCodec.instance.encode(ctx, getmanifest))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentCommand] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Unlock" =>
                  ContentCommand.Unlock_JsonCodec.instance.decode(ctx, json)
                
                case "RedeemGrant" =>
                  ContentCommand.RedeemGrant_JsonCodec.instance.decode(ctx, json)
                
                case "Logout" =>
                  ContentCommand.Logout_JsonCodec.instance.decode(ctx, json)
                
                case "GetManifest" =>
                  ContentCommand.GetManifest_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentCommand: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentCommand: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentCommand: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContentCommand.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContentCommand.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContentCommand.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentCommand]] = Lazy(ContentCommand_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentCommand]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContentCommand] = LazyInstance.value
  }
}