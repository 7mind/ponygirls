package haystack.http

import cats.effect.{IO,Ref,Resource}
import cats.effect.std.Queue
import cats.syntax.all.*
import org.http4s.websocket.WebSocketFrame
import haystack.auth.{Auth,Authenticated}
import java.util.UUID
import io.circe.Json

final case class LiveSession(id:UUID,auth:Authenticated,queue:Queue[IO,WebSocketFrame],closed:Ref[IO,Boolean],queuedBytes:Ref[IO,Long])
final class LiveHub private(sessions:Ref[IO,Map[UUID,LiveSession]]) {
  def register(auth:Authenticated):Resource[IO,LiveSession]=Resource.make {
    for {
      q<-Queue.bounded[IO,WebSocketFrame](64)
      closed<-Ref.of[IO,Boolean](false)
      bytes<-Ref.of[IO,Long](0L)
      session=LiveSession(UUID.randomUUID(),auth,q,closed,bytes)
      allowed<-sessions.modify { current =>
        if(current.values.count(_.auth.principal==auth.principal)>=8) (current,false)
        else (current.updated(session.id,session),true)
      }
      _<-if(allowed) IO.unit else IO.raiseError(haystack.domain.Fault("rate-limited","too many live connections"))
    } yield session
  }(s=>s.closed.set(true) *> sessions.update(_ - s.id))
  def send(session:LiveSession,frame:WebSocketFrame):IO[Unit]=IO.uncancelable { _=>session.closed.get.ifM(IO.unit,
    session.queuedBytes.modify { bytes=>
      if(bytes+frame.length>64*1024) (bytes,false) else (bytes+frame.length,true)
    }.flatMap {
      case false=>close(session,1013)
      case true=>session.queue.tryOffer(frame).flatMap {
        case true=>IO.unit
        case false=>session.queuedBytes.update(n=>math.max(0L,n-frame.length)) *> close(session,1013)
      }
    })
  }
  def take(session:LiveSession):IO[WebSocketFrame]=session.queue.take.flatTap(frame=>session.queuedBytes.update(n=>math.max(0L,n-frame.length)))
  def close(session:LiveSession,code:Int):IO[Unit]=session.closed.getAndSet(true).flatMap {
    case true=>IO.unit
    case false=>
      def drain:IO[Unit]=session.queue.tryTake.flatMap(_.fold(IO.unit)(_=>drain))
      drain *> session.queuedBytes.set(0L) *> session.queue.tryOffer(WebSocketFrame.Close(code,"haystack").fold(throw _,identity)).void
  }
  def authorized(session:LiveSession,auth:Auth):IO[Boolean]={
    val valid=auth.authenticate(session.auth.token).contains(session.auth.principal)
    if(valid) IO.pure(true) else close(session,4401).as(false)
  }
  def endSession(token:String):IO[Unit]=sessions.get.flatMap(_.values.filter(_.auth.token==token).toList.traverse_(close(_,4401)))
  def changed(key:String,revision:Long,currentAuth:Auth):IO[Unit]={
    val frame=WebSocketFrame.Text(Wire.encode(haystack.api.LiveFrame.codecJson,haystack.api.LiveFrame("changed",Some(key),Some(revision.toInt),None,None,None)).noSpaces)
    sessions.get.flatMap(_.values.toList.traverse_(session=>authorized(session,currentAuth).flatMap(ok=>if(ok)send(session,frame)else IO.unit)))
  }
}
object LiveHub { def create:IO[LiveHub]=Ref.of[IO,Map[UUID,LiveSession]](Map.empty).map(new LiveHub(_)) }
