package rites

import java.io.{ByteArrayOutputStream, InputStream}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.util.concurrent.TimeUnit
import scala.collection.mutable
import scala.jdk.CollectionConverters.*

private[rites] object Processes {
  final case class Output(code: Int, stdout: Array[Byte], stderr: Array[Byte])
  private def limited(stream: InputStream, bound: Int): Array[Byte] = {
    val bytes = stream.readNBytes(bound + 1); Check(bytes.length <= bound, "invalid", "subprocess output too large"); bytes
  }
  def run(command: List[String], cwd: Path, environment: Map[String, String], stdin: Array[Byte], bound: Int, seconds: Int, timeoutCode: String): Output = {
    Check(command.nonEmpty && command.forall(_.nonEmpty), "invalid", "invalid subprocess")
    val builder = new ProcessBuilder(command.asJava); builder.directory(cwd.toFile)
    val env = builder.environment(); env.clear(); environment.foreach((k, v) => env.put(k, v))
    val process = builder.start()
    val stdout = reader(process.getInputStream, bound); stdout.setDaemon(true); stdout.start()
    val stderr = reader(process.getErrorStream, 65536); stderr.setDaemon(true); stderr.start()
    val writing = new Thread(() => { try { process.getOutputStream.write(stdin); process.getOutputStream.close() } catch { case _: java.io.IOException => () } }); writing.setDaemon(true); writing.start()
    val escaped = mutable.Set.empty[Long]
    var timedOut = false
    def snapshot(): Unit = process.toHandle.descendants().forEach(h => escaped += h.pid())
    def kill(): Unit = {
      snapshot(); process.toHandle.descendants().forEach(h => h.destroyForcibly()); process.destroyForcibly()
      escaped.foreach(pid => ProcessHandle.of(pid).ifPresent(_.destroyForcibly()))
    }
    try {
      if (!process.waitFor(seconds.toLong, TimeUnit.SECONDS)) { timedOut = true; snapshot(); kill(); Check(process.waitFor(5, TimeUnit.SECONDS), "worker-timeout", "worker did not terminate") }
      snapshot()
      stdout.join(5000); stderr.join(5000); writing.join(5000)
      Check(!stdout.isAlive && !stderr.isAlive, "worker-protocol", "uncollected subprocess output")
      val out = stdout.result(); val err = stderr.result()
      val outBytes = out.fold(_ => throw DomainError("worker-protocol", "subprocess output bound exceeded"), identity)
      val errBytes = err.fold(_ => throw DomainError("worker-protocol", "subprocess output bound exceeded"), identity)
      if (escaped.exists(pid => ProcessHandle.of(pid).map(_.isAlive).orElse(false))) { kill(); throw DomainError("sandbox-children", "worker descendants survived") }
      if (timedOut) throw DomainError(timeoutCode, "worker deadline exceeded")
      Output(process.exitValue(), outBytes, errBytes)
    } catch {
      case error: DomainError => kill(); throw error
      case _: InterruptedException => Thread.currentThread().interrupt(); kill(); throw DomainError("cancelled", "worker interrupted")
      case scala.util.control.NonFatal(_) => kill(); throw DomainError("worker-protocol", "worker execution failed")
    }
  }
  private[rites] final class ThreadResult(body: => Array[Byte]) extends Thread {
    private var value: Either[Throwable, Array[Byte]] = Left(DomainError("worker-protocol", "thread not complete"))
    override def run(): Unit = value = try Right(body) catch { case scala.util.control.NonFatal(e) => Left(e) }
    def result(): Either[Throwable, Array[Byte]] = value
  }
  /** Start a reader as the concrete result-bearing class, not a lambda Thread. */
  def reader(stream: InputStream, bound: Int): ThreadResult = new ThreadResult(limited(stream, bound))
  def pathEnvironment: Map[String, String] = Map("PATH" -> sys.env.getOrElse("PATH", "/usr/bin:/bin"), "LANG" -> "C.UTF-8", "LC_ALL" -> "C.UTF-8")
}
