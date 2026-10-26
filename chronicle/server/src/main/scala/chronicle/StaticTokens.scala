package chronicle
import chronicle.api.*
import java.nio.file.{Files,Path}
import java.nio.file.attribute.PosixFilePermission
import java.sql.Connection
import java.time.Instant
import java.util.UUID
import scala.util.Using

object StaticTokens {
  private def hash(t: StaticTokenConfig): String = {
    try {
      val path=Path.of(t.tokenFile).toRealPath()
      Check(!path.startsWith(Path.of("/nix/store")) && Files.isRegularFile(path),"config","static token requires runtime credential file")
      val forbidden=Set(PosixFilePermission.GROUP_READ,PosixFilePermission.GROUP_WRITE,PosixFilePermission.GROUP_EXECUTE,PosixFilePermission.OTHERS_READ,PosixFilePermission.OTHERS_WRITE,PosixFilePermission.OTHERS_EXECUTE)
      import scala.jdk.CollectionConverters.*
      Check(Files.getPosixFilePermissions(path).asScala.intersect(forbidden).isEmpty,"config","static token credential must be private")
      val bytes=Using.resource(Files.newInputStream(path))(_.readNBytes(4097))
      Check(bytes.length<=4096,"config","invalid static token credential")
      val secret=new String(bytes,java.nio.charset.StandardCharsets.UTF_8).stripTrailing()
      Check(secret.length>=43 && secret.length<=1024 && secret.matches("[A-Za-z0-9_+/.=-]+") && secret.distinct.length>=16,"config","static token credential must be strong")
      Wire.hash(secret)
    } catch { case d: DomainError => throw d; case _: Exception => throw DomainError("config","cannot load static token credential") }
  }
  def reconcile(c: Connection,config: Config): Unit = {
    config.validate()
    val entries=config.staticTokens.map(t => (t,hash(t)))
    Check(entries.map(_._2).distinct.size==entries.size,"config","duplicate static token values")
    // Serializes startup reconciliation with mint/revoke, including identities not yet present.
    Sql.exec(c,"LOCK TABLE ch_tokens IN SHARE ROW EXCLUSIVE MODE")
    entries.foreach { case (t,h) =>
      Sql.one(c,"SELECT owner,static_config FROM ch_tokens WHERE id=?",t.id) { r =>
        Check(r.getString(1)==t.userId && r.getBoolean(2),"config","static token ID collision")
      }
      Check(!Sql.one(c,"SELECT id FROM ch_tokens WHERE hash=? AND id<>?",h,t.id)(_ => true).contains(true),"config","static token value collision")
    }
    val configured=entries.map(_._1.id).toSet
    Sql.rows(c,"SELECT id FROM ch_tokens WHERE static_config")(_.getObject(1,classOf[UUID])).filterNot(configured).foreach(id => Sql.exec(c,"DELETE FROM ch_tokens WHERE id=?",id))
    entries.foreach { case (t,h) =>
      val created=Sql.one(c,"SELECT info FROM ch_tokens WHERE id=?",t.id)(r => Wire.decode(TokenInfo.codecJson,Sql.json(r,"info")).createdAt).getOrElse(Instant.now().toString)
      val info=TokenInfo(t.id,t.name,t.scopes,created,false)
      Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info,static_config) VALUES(?,?,?,?::jsonb,true) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,info=excluded.info,revoked=false",t.id,t.userId,h,Wire.encode(TokenInfo.codecJson,info).noSpaces)
    }
  }
}
