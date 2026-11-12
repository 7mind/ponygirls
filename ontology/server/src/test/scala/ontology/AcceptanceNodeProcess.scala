package ontology

import cats.effect.{IO, Resource}
import java.nio.file.{Files, Path}
import java.util.UUID
import java.util.concurrent.TimeUnit
import scala.util.Using

private[ontology] object AcceptanceNodeProcess {
  private val cleanupAndReportingSeconds = 40L
  private val forcedJoinSeconds = 15L
  def run(python: Path, node: Path, driver: Path, arguments: List[String], report: Path, label: String, deadlineSeconds: Long): IO[Unit] = {
    require(label.matches("[a-z-]+") && deadlineSeconds > 0, "invalid controlled process parameters")
    val runId = UUID.randomUUID().toString
    val receipt = report.resolve(label + "-process.json")
    val supervisor = report.resolve(label + "-supervisor.py")
    def cleanupReceipt(): io.circe.HCursor = {
      val value = Wire.parse(Files.readAllBytes(receipt)).hcursor
      require(value.get[Int]("version").contains(1) && value.get[String]("runId").contains(runId) && value.get[String]("label").contains(label), "supervisor receipt identity mismatch")
      require(value.get[Boolean]("subreaperConfirmed").contains(true) && value.get[Boolean]("cleanupConfirmed").contains(true), "descendant cleanup unconfirmed")
      value
    }
    Resource.make(IO.blocking {
      Using.resource(Option(getClass.getResourceAsStream("/owned-node.py")).getOrElse(throw new IllegalStateException("owned supervisor resource missing"))) { input =>
        Files.copy(input, supervisor)
      }
      new ProcessBuilder((List(python.toString, "-I", "-S", supervisor.toString, deadlineSeconds.toString, runId, label,
        receipt.toString, node.toString, driver.toString) ++ arguments)*)
        .redirectOutput(report.resolve(label + ".stdout").toFile)
        .redirectError(report.resolve(label + ".stderr").toFile).start()
    }) { child => IO.blocking {
      if (child.isAlive) {
        child.destroy()
        if (!child.waitFor(cleanupAndReportingSeconds, TimeUnit.SECONDS)) {
          child.destroyForcibly()
          val exited = child.waitFor(forcedJoinSeconds, TimeUnit.SECONDS)
          throw new AssertionError(s"supervisor forced termination; descendant cleanup unconfirmed; supervisor exit observed=$exited")
        }
      }
      cleanupReceipt()
      ()
    } }.use { child =>
      IO.interruptible(child.waitFor(Math.addExact(deadlineSeconds, cleanupAndReportingSeconds), TimeUnit.SECONDS)).flatMap { exited => IO.blocking {
        require(exited, "controlled supervisor watchdog exceeded")
        Files.writeString(report.resolve(label + "-supervisor-exit"), child.exitValue().toString + "\n")
        val value = cleanupReceipt()
        Files.writeString(report.resolve(label + "-exit"), value.downField("mainExit").focus.get.noSpaces + "\n")
        require(child.exitValue() == 0 && value.get[Int]("mainExit").contains(0) && value.get[Boolean]("timedOut").contains(false) &&
          value.get[Boolean]("forcedCleanup").contains(false) && value.downField("stopSignal").focus.exists(_.isNull) &&
          value.downField("diagnostic").focus.exists(_.isNull), "controlled child failed: " + label)
      } }
    }
  }
}
