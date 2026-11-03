import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package manure.api {
  sealed trait ExpiryChange extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ExpiryChange.baboonDomainVersion
    override def baboonDomainIdentifier: String = ExpiryChange.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ExpiryChange.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ExpiryChange.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ExpiryChange.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ExpiryChange.baboonMinReaderVersions
  }
  
  object ExpiryChange {
    final case class Keep(
      
    ) extends ExpiryChange with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpiryChange.Keep.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpiryChange.Keep.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpiryChange.Keep.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpiryChange.Keep.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpiryChange.Keep.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpiryChange.Keep.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpiryChange.Keep.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Keep.baboonAdtType
    }
    
    object Keep {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ExpiryChange]#Keep"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ExpiryChange"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.getClass
      def codecJson: BaboonJsonCodec[ExpiryChange.Keep] = ExpiryChange.Keep_JsonCodec.instance
    }
    
    object Keep_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpiryChange.Keep, BaboonJsonCodec[ExpiryChange.Keep]] {
      def encode(ctx: BaboonCodecContext, value: ExpiryChange.Keep): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpiryChange.Keep] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ExpiryChange.Keep())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Keep: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpiryChange.Keep.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpiryChange.Keep.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpiryChange.Keep.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpiryChange.Keep.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Keep.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Keep]] = Lazy(ExpiryChange.Keep_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Keep]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpiryChange.Keep] = LazyInstance.value
    }
    
    
    final case class Clear(
      
    ) extends ExpiryChange with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpiryChange.Clear.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpiryChange.Clear.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpiryChange.Clear.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpiryChange.Clear.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpiryChange.Clear.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpiryChange.Clear.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpiryChange.Clear.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Clear.baboonAdtType
    }
    
    object Clear {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ExpiryChange]#Clear"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ExpiryChange"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.getClass
      def codecJson: BaboonJsonCodec[ExpiryChange.Clear] = ExpiryChange.Clear_JsonCodec.instance
    }
    
    object Clear_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpiryChange.Clear, BaboonJsonCodec[ExpiryChange.Clear]] {
      def encode(ctx: BaboonCodecContext, value: ExpiryChange.Clear): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpiryChange.Clear] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ExpiryChange.Clear())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Clear: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpiryChange.Clear.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpiryChange.Clear.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpiryChange.Clear.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpiryChange.Clear.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Clear.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Clear]] = Lazy(ExpiryChange.Clear_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Clear]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpiryChange.Clear] = LazyInstance.value
    }
    
    
    final case class Set(
      seconds: Int
    ) extends ExpiryChange with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpiryChange.Set.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpiryChange.Set.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpiryChange.Set.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpiryChange.Set.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpiryChange.Set.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpiryChange.Set.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpiryChange.Set.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Set.baboonAdtType
    }
    
    object Set {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ExpiryChange]#Set"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ExpiryChange"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.getClass
      def codecJson: BaboonJsonCodec[ExpiryChange.Set] = ExpiryChange.Set_JsonCodec.instance
    }
    
    object Set_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpiryChange.Set, BaboonJsonCodec[ExpiryChange.Set]] {
      def encode(ctx: BaboonCodecContext, value: ExpiryChange.Set): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "seconds" -> Json.fromInt(value.seconds)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpiryChange.Set] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              seconds <- getField(jsonObject, "seconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            } yield ExpiryChange.Set(seconds)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Set: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpiryChange.Set.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpiryChange.Set.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpiryChange.Set.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpiryChange.Set.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpiryChange.Set.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Set]] = Lazy(ExpiryChange.Set_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpiryChange.Set]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpiryChange.Set] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ExpiryChange"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ExpiryChange] = ExpiryChange_JsonCodec.instance
  }
  
  object ExpiryChange_JsonCodec extends BaboonJsonCodec.BaseGenerated[ExpiryChange, BaboonJsonCodec[ExpiryChange]] {
    def encode(ctx: BaboonCodecContext, value: ExpiryChange): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case keep: ExpiryChange.Keep => Json.obj("Keep" -> ExpiryChange.Keep_JsonCodec.instance.encode(ctx, keep))
        
        case clear: ExpiryChange.Clear => Json.obj("Clear" -> ExpiryChange.Clear_JsonCodec.instance.encode(ctx, clear))
        
        case set: ExpiryChange.Set => Json.obj("Set" -> ExpiryChange.Set_JsonCodec.instance.encode(ctx, set))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpiryChange] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Keep" =>
                  ExpiryChange.Keep_JsonCodec.instance.decode(ctx, json)
                
                case "Clear" =>
                  ExpiryChange.Clear_JsonCodec.instance.decode(ctx, json)
                
                case "Set" =>
                  ExpiryChange.Set_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpiryChange: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpiryChange: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpiryChange: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ExpiryChange.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ExpiryChange.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ExpiryChange.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpiryChange]] = Lazy(ExpiryChange_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpiryChange]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpiryChange] = LazyInstance.value
  }
}