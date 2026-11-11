package ontology

import cats.effect.{IO, Resource}
import java.io.{DataInputStream, DataOutputStream, EOFException}
import java.net.{InetAddress, ServerSocket, Socket, URI}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.{CountDownLatch, TimeUnit}
import java.util.concurrent.atomic.{AtomicBoolean, AtomicReference}

/** Test-only loopback relay: pause a matching SQL Parse message before PostgreSQL sees it. */
final class PostgresQueryBarrier private (upstream: URI, queryPrefix: String) {
  private val MaximumFrameBytes = 1024 * 1024
  private val WaitSeconds = 15L
  private val listener = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
  private val client = new AtomicReference[Socket]()
  private val peer = new AtomicReference[Socket]()
  private val failure = new AtomicReference[Throwable]()
  private val closing = new AtomicBoolean(false)
  private val gated = new AtomicBoolean(false)
  private val arrived = new CountDownLatch(1)
  private val released = new CountDownLatch(1)
  private val responseThread = new AtomicReference[Thread]()
  val jdbcUrl: String = s"jdbc:postgresql://127.0.0.1:${listener.getLocalPort}${upstream.getRawPath}"

  private def worker(name: String)(work: => Unit): Thread = {
    val thread = new Thread(() => try work catch {
      case error: Throwable if !closing.get() => failure.compareAndSet(null, error); arrived.countDown()
      case _: Throwable => ()
    }, name)
    thread.setDaemon(true)
    thread.start()
    thread
  }
  private def frame(in: DataInputStream, length: Int, minimum: Int): Array[Byte] = {
    require(length >= minimum && length <= MaximumFrameBytes, "invalid controlled PostgreSQL frame size")
    val bytes = in.readNBytes(length - 4)
    if (bytes.length != length - 4) throw new EOFException("incomplete controlled PostgreSQL frame")
    bytes
  }
  private def sql(bytes: Array[Byte]): String = {
    val nameEnd = bytes.indexOf(0.toByte)
    val queryEnd = bytes.indexOf(0.toByte, nameEnd + 1)
    require(nameEnd >= 0 && queryEnd > nameEnd, "invalid controlled Parse frame")
    new String(bytes, nameEnd + 1, queryEnd - nameEnd - 1, UTF_8)
  }
  private val requestThread = worker("owned-pg-request-barrier") {
    val incoming = listener.accept(); client.set(incoming)
    val outgoing = new Socket(upstream.getHost, upstream.getPort); peer.set(outgoing)
    responseThread.set(worker("owned-pg-response-relay") { outgoing.getInputStream.transferTo(incoming.getOutputStream); () })
    val in = new DataInputStream(incoming.getInputStream)
    val out = new DataOutputStream(outgoing.getOutputStream)
    var startup = true
    while (startup) {
      val length = in.readInt()
      val bytes = frame(in, length, 8)
      out.writeInt(length); out.write(bytes); out.flush()
      startup = length == 8
    }
    var tag = in.read()
    while (tag >= 0) {
      val length = in.readInt()
      val bytes = frame(in, length, 4)
      if (tag == 'P'.toInt && sql(bytes).startsWith(queryPrefix) && gated.compareAndSet(false, true)) {
        arrived.countDown()
        require(released.await(WaitSeconds, TimeUnit.SECONDS), "controlled query barrier release timed out")
      }
      out.write(tag); out.writeInt(length); out.write(bytes); out.flush()
      tag = in.read()
    }
  }
  def awaitQuery: IO[Unit] = IO.blocking {
    require(arrived.await(WaitSeconds, TimeUnit.SECONDS), "controlled query did not reach barrier")
    val error = failure.get()
    if (error != null) throw new IllegalStateException("controlled PostgreSQL relay failed", error)
    require(gated.get(), "controlled SQL query was not observed")
  }
  def release: IO[Unit] = IO(released.countDown())
  private def close(): Unit = {
    closing.set(true); released.countDown(); listener.close()
    List(client.get(), peer.get()).filter(_ != null).foreach(_.close())
    requestThread.join(TimeUnit.SECONDS.toMillis(WaitSeconds))
    val response = responseThread.get()
    if (response != null) response.join(TimeUnit.SECONDS.toMillis(WaitSeconds))
    require(!requestThread.isAlive && (response == null || !response.isAlive), "controlled relay did not settle")
  }
}
object PostgresQueryBarrier {
  def resource(jdbcUrl: String, queryPrefix: String): Resource[IO, PostgresQueryBarrier] =
    Resource.make(IO.blocking(new PostgresQueryBarrier(URI.create(jdbcUrl.stripPrefix("jdbc:")), queryPrefix)))(value => IO.blocking(value.close()))
}
