package chronicle

import cats.effect.IO
import java.util.concurrent.atomic.AtomicLong

/** Shared by all source reads belonging to one tool invocation. Consume before fetching payloads. */
trait ReadAdmission {
  def consume(bytes: Long): Unit
}

object ReadAdmission {
  val unlimited: ReadAdmission = new ReadAdmission {
    def consume(bytes: Long): Unit = Check(bytes>=0,"read-budget","invalid source byte count")
  }

  def limited(maximumBytes: Long): IO[ReadAdmission] = IO {
    Check(maximumBytes>=0,"read-budget","invalid source byte limit")
    new ReadAdmission {
      private val consumed = new AtomicLong(0L)
      def consume(bytes: Long): Unit = {
        Check(bytes>=0,"read-budget","invalid source byte count")
        var admitted=false
        while(!admitted) {
          val previous=consumed.get()
          Check(bytes<=maximumBytes-previous,"read-budget","source read limit exceeded")
          admitted=consumed.compareAndSet(previous,previous+bytes)
        }
      }
    }
  }
}
