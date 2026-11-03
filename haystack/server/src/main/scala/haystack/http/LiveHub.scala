package haystack.http

import cats.effect.{IO,Ref,Resource}
import cats.effect.std.Queue
import cats.syntax.all.*
import org.http4s.websocket.WebSocketFrame
import haystack.auth.{Auth,Authenticated}
import java.util.UUID
import io.circe.Json

final case class LiveSession(id:UUID,auth:Authenticated,queue:Queue[IO,WebSocketFrame],closed:Ref[IO,Boolean])
final class LiveHub private(sessions:Ref[IO,Map[UUID,LiveSession]]) {
  def register(auth:Authenticated):Resource[IO,LiveSession]=Resource.make {
    for {
      q<-Queue.bounded[IO,WebSocketFrame](64)
      closed<-Ref.of[IO,Boolean](false)
      session=LiveSession(UUID.randomUUID(),auth,q,closed)
      allowed<-sessions.modify { current =>
        if(current.values.count(_.auth.principal==auth.principal)>=8) (current,false)
        else (current.updated(session.id,session),true)
      }
      _<-if(allowed) IO.unit else IO.raiseError(haystack.domain.Fault("rate-limited","too many live connections"))
    } yield session
  }(s=>s.closed.set(true) *> sessions.update(_ - s.id))
  def send(session:LiveSession,frame:WebSocketFrame):IO[Unit]=session.closed.get.ifM(IO.unit,session.queue.tryOffer(frame).flatMap {
    case true=>IO.unit
    case false=>close(session,1013)
  })
  def close(session:LiveSession,code:Int):IO[Unit]=session.closed.getAndSet(true).flatMap {
    case true=>IO.unit
    case false=>session.queue.tryTake *> session.queue.tryOffer(WebSocketFrame.Close(code,"haystack").fold(throw _,identity)).void
  }
  def authorized(session:LiveSession,auth:Auth):IO[Boolean]={
    val valid=auth.authenticate(session.auth.token).contains(session.auth.principal)
    if(valid) IO.pure(true) else close(session,4401).as(false)
  }
  def endSession(token:String):IO[Unit]=sessions.get.flatMap(_.values.filter(_.auth.token==token).toList.traverse_(close(_,4401)))
  def changed(key:String,revision:Long):IO[Unit]={
    val frame=WebSocketFrame.Text(Json.obj("type"->Json.fromString("changed"),"key"->Json.fromString(key),"revision"->Json.fromLong(revision)).noSpaces)
    sessions.get.flatMap(_.values.toList.traverse_(send(_,frame)))
  }
}
object LiveHub { def create:IO[LiveHub]=Ref.of[IO,Map[UUID,LiveSession]](Map.empty).map(new LiveHub(_)) }
