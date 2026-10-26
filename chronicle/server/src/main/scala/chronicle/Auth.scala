package chronicle
import chronicle.api.*
import java.util.UUID
import java.time.Instant
import java.sql.Connection

final class Auth(db: Database, config: Config) {
  private val allScopes = List(Scope.Ingest,Scope.Read,Scope.Raw)
  def login(r: LoginRequest): (LoginResponse,String) = db.transaction { c =>
    Check.text(r.login,128); Check.text(r.password,1024)
    val user = Sql.one(c,"SELECT id,credential FROM ch_users WHERE login=? AND enabled",r.login)(x => (x.getString(1),x.getString(2)))
    val valid = user.exists(u => Password.verify(r.password.toCharArray,u._2))
    if(user.isEmpty) Password.verify(r.password.toCharArray,Password.hash("dummy".toCharArray))
    Check(valid,"unauthorized","invalid credentials")
    val secret = Wire.secret(); val id = user.get._1
    Sql.exec(c,"INSERT INTO ch_sessions VALUES(?,?,now()+make_interval(secs=>?))",Wire.hash(secret),id,config.sessionTtlSeconds)
    (LoginResponse(UserInfo(id,r.login,allScopes),Wire.versions),secret)
  }
  def browser(secret: String): Identity = db.transaction { c =>
    Sql.one(c,"SELECT u.id,u.login FROM ch_sessions s JOIN ch_users u ON u.id=s.owner WHERE s.hash=? AND s.expires>now() AND u.enabled",Wire.hash(secret))(r => Identity(UserInfo(r.getString(1),r.getString(2),allScopes),true,Wire.hash(secret))).getOrElse(throw DomainError("unauthorized","session expired or revoked"))
  }
  def bearer(secret: String): Identity = db.transaction { c =>
    Sql.one(c,"SELECT u.id,u.login,t.info FROM ch_tokens t JOIN ch_users u ON u.id=t.owner WHERE t.hash=? AND NOT t.revoked AND u.enabled",Wire.hash(secret)) { r =>
      val t = Wire.decode(TokenInfo.codecJson,Sql.json(r,"info")); Identity(UserInfo(r.getString(1),r.getString(2),t.scopes),false,Wire.hash(secret))
    }.getOrElse(throw DomainError("unauthorized","invalid agent credential"))
  }
  def logout(i: Identity): Unit = db.transaction { c => Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=?",i.credentialHash); () }
  def tokens(i: Identity): TokensResult = { i.requireBrowser(); db.transaction(c => TokensResult(Sql.rows(c,"SELECT info,revoked FROM ch_tokens WHERE owner=? ORDER BY id LIMIT 100",i.user.id)(r => ListedToken(Wire.decode(TokenInfo.codecJson,Sql.json(r,"info")).copy(revoked=r.getBoolean("revoked")),TokenSource.Issued)))) }
  def groups(i: Identity): GroupsResult = { i.requireBrowser(); db.transaction { c =>
    val gs = Sql.rows(c,"SELECT g.* FROM ch_groups g JOIN ch_members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.id LIMIT 100",i.user.id) { r => val id = r.getObject("id",classOf[UUID]); GroupInfo(id,r.getString("name"),r.getString("owner"),Sql.rows(c,"SELECT user_id FROM ch_members WHERE group_id=? ORDER BY user_id LIMIT 100",id)(_.getString(1))) }
    val invites = Sql.rows(c,"SELECT id,group_id,target,expires FROM ch_invites WHERE target=? AND NOT accepted AND expires>now() ORDER BY id LIMIT 100",i.user.id)(r => InviteInfo(r.getObject(1,classOf[UUID]),r.getObject(2,classOf[UUID]),r.getString(3),r.getTimestamp(4).toInstant.toString))
    GroupsResult(gs,invites)
  }}
  def receipt(i: Identity,id: UUID): Result = { i.requireBrowser(); db.transaction(c => Sql.one(c,"SELECT result FROM ch_mutations WHERE owner=? AND request_id=?",i.user.id,id)(r => Wire.decode(Result.codecJson,Sql.json(r,"result"))).getOrElse(throw DomainError("not-found","receipt not found"))) }
  def mutate(i: Identity,e: ClientEnvelope): Result = { i.requireBrowser(); db.transaction { c =>
    Sql.lock(c,s"mutation:${i.user.id}")
    val digest = Wire.hash(Wire.canonical(Wire.encode(Operation.codecJson,e.operation)))
    Sql.one(c,"SELECT digest,result FROM ch_mutations WHERE owner=? AND request_id=?",i.user.id,e.requestId) { r => Check(r.getString(1)==digest,"conflict","request ID bound to different payload"); Wire.decode(Result.codecJson,Sql.json(r,"result")) } match {
      case Some(r) => r
      case None =>
        val response = mutation(c,i,e)
        val stored = response match { case Result.Token(r) => Result.Token(r.copy(secret=None)); case other => other }
        Sql.exec(c,"INSERT INTO ch_mutations VALUES(?,?,?,?::jsonb)",i.user.id,e.requestId,digest,Wire.encode(Result.codecJson,stored).noSpaces)
        response
    }
  }}
  private def mutation(c: Connection,i: Identity,e: ClientEnvelope): Result = {
    val owner = i.user.id
    def receipt(op: String,id: Option[UUID]): Result = Result.Mutation(MutationReceipt(e.requestId,op,id))
    def groupOwner(id: UUID): Unit = Check(Sql.one(c,"SELECT 1 FROM ch_groups WHERE id=? AND owner=? FOR UPDATE",id,owner)(_ => true).contains(true),"not-found","group not found")
    e.operation match {
      case Operation.MintToken(name,scopes) =>
        Check.text(name,128); Check(scopes.nonEmpty && scopes.distinct.size==scopes.size && (!scopes.contains(Scope.Raw)||scopes.contains(Scope.Read)),"invalid","invalid scopes")
        Check(Sql.one(c,"SELECT count(*) FROM ch_tokens WHERE owner=? AND NOT revoked",owner)(_.getInt(1)).get < 100,"invalid","token limit")
        val secret = Wire.secret(); val t = TokenInfo(UUID.randomUUID(),name,scopes,Instant.now().toString,false)
        Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info) VALUES(?,?,?,?::jsonb)",t.id,owner,Wire.hash(secret),Wire.encode(TokenInfo.codecJson,t).noSpaces)
        Result.Token(TokenResult(t,Some(secret)))
      case Operation.RevokeToken(id) =>
        Check(Sql.exec(c,"UPDATE ch_tokens SET revoked=true WHERE id=? AND owner=?",id,owner)==1,"not-found","token not found"); receipt("RevokeToken",Some(id))
      case Operation.CreateGroup(name) =>
        Check.text(name,128)
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE user_id=?",owner)(_.getInt(1)).get < 100,"invalid","group limit")
        val id = UUID.randomUUID(); Sql.exec(c,"INSERT INTO ch_groups VALUES(?,?,?)",id,owner,name); Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",id,owner); receipt("CreateGroup",Some(id))
      case Operation.Invite(id,target) =>
        groupOwner(id)
        Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",target)(_ => true).contains(true),"not-found","user not found")
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE group_id=?",id)(_.getInt(1)).get < 100,"invalid","member limit")
        Check(Sql.one(c,"SELECT count(*) FROM ch_invites WHERE group_id=? AND NOT accepted AND expires>now()",id)(_.getInt(1)).get < 100,"invalid","invitation limit")
        val invitation = UUID.randomUUID(); Sql.exec(c,"INSERT INTO ch_invites(id,group_id,target,expires) VALUES(?,?,?,now()+interval '24 hours')",invitation,id,target); receipt("Invite",Some(invitation))
      case Operation.AcceptInvite(id,confirm) =>
        Check(confirm,"invalid","explicit sharing confirmation required")
        val group = Sql.one(c,"SELECT group_id FROM ch_invites WHERE id=? AND target=? AND NOT accepted AND expires>now() FOR UPDATE",id,owner)(_.getObject(1,classOf[UUID])).getOrElse(throw DomainError("not-found","invitation not found"))
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE user_id=?",owner)(_.getInt(1)).get < 100,"invalid","group limit")
        Sql.exec(c,"INSERT INTO ch_members VALUES(?,?) ON CONFLICT DO NOTHING",group,owner); Sql.exec(c,"UPDATE ch_invites SET accepted=true WHERE id=?",id); receipt("AcceptInvite",Some(group))
      case Operation.RemoveMember(id,user) => groupOwner(id); Check(user!=owner,"invalid","owner cannot be removed"); Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id=?",id,user); receipt("RemoveMember",Some(id))
      case Operation.LeaveGroup(id) =>
        Check(!Sql.one(c,"SELECT 1 FROM ch_groups WHERE id=? AND owner=?",id,owner)(_ => true).contains(true),"invalid","owner must delete group")
        Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id=?",id,owner); receipt("LeaveGroup",Some(id))
      case Operation.DeleteGroup(id) => groupOwner(id); Sql.exec(c,"DELETE FROM ch_groups WHERE id=?",id); receipt("DeleteGroup",Some(id))
      case Operation.RetryJob(id) =>
        Jobs.retry(c,owner,id); receipt("RetryJob",Some(id))
      case Operation.Purge(id) =>
        Check(Sql.exec(c,"UPDATE ch_sources SET tombstone=true,published=NULL WHERE id=? AND owner=?",id,owner)==1,"not-found","session not found")
        Sql.exec(c,"DELETE FROM ch_chunks WHERE generation IN(SELECT id FROM ch_generations WHERE session_id=?)",id); Sql.exec(c,"DELETE FROM ch_generations WHERE session_id=?",id); Sql.exec(c,"DELETE FROM ch_jobs WHERE session_id=?",id); Sql.exec(c,"DELETE FROM ch_revisions WHERE session_id=?",id)
        receipt("Purge",Some(id))
      case Operation.Logout() => Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=?",i.credentialHash); receipt("Logout",None)
      case _ => throw DomainError("invalid","not a mutation")
    }
  }
}
