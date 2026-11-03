package haystack

import cats.effect.{IO,Deferred,Resource}
import cats.effect.std.Dispatcher
import cats.syntax.all.*

/** Process-owned POSIX signal lifetime. Returning the main IO after resource
  * cancellation gives the same clean exit0 contract as the previous server,
  * rather than JVM shutdown-hook exit143 or a forced-kill drain. JDBC callbacks
  * remain uncancelable until their configured transaction deadlines complete.
  */
private[haystack] object GracefulShutdown {
  def resource:Resource[IO,IO[Unit]]=for{
    stop<-Resource.eval(Deferred[IO,Unit])
    dispatcher<-Dispatcher.parallel[IO]
    _<-List("TERM","INT").traverse_ { name=>Resource.make(IO {
      val signal=new sun.misc.Signal(name)
      val previous=sun.misc.Signal.handle(signal,new sun.misc.SignalHandler {
        override def handle(received:sun.misc.Signal):Unit=dispatcher.unsafeRunAndForget(stop.complete(()).void)
      })
      signal->previous
    }) { case(signal,previous)=>IO { sun.misc.Signal.handle(signal,previous);() } }
    }
  }yield stop.get
}
