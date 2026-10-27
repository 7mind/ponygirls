package chronicle

import cats.effect.{IO,Resource}
import cats.syntax.all.*
import chronicle.api.*
import io.circe.Json
import java.util.UUID

final case class McpReadHandle(requestId: UUID,instanceId: UUID,runId: UUID,afterSequence: Long,limit: Int)

enum BrowserReply {
  case Ordinary(envelope: ServerEnvelope)
  case McpRead(handle: McpReadHandle)
  case McpCatalog(requestId: UUID)
}

final class BrowserRpc(app: Application,runs: McpTestRuns,wire: McpTestWire) {
  private val initialReadLimit=1

  def connection(id: UUID): Resource[IO,McpRunConnection] = runs.connection(id)

  def isControl(operation: Operation): Boolean = operation match {
    case _: Operation.McpTestTools | _: Operation.StartMcpTest | _: Operation.ReadMcpTest | _: Operation.CancelMcpTest | _: Operation.Logout | _: Operation.ExpressionHints | _: Operation.ModelUsage => true
    case _ => false
  }

  def ordinary(identity: Identity,envelope: ClientEnvelope,version: String): IO[Result] = app.operationVersion(identity,envelope,version)

  def execute(identity: Identity,envelope: ClientEnvelope,version: String,connection: McpRunConnection): IO[BrowserReply] = IO.defer {
    def requireTester(): Unit = {
      Check(wire.supportedVersions.contains(version),"version-mismatch","MCP testing requires API 1.4.0 or 1.5.0")
      identity.requireBrowser()
      identity.requireScope(Scope.Read)
    }
    def read(instance: UUID,run: UUID,after: Long,limit: Int): BrowserReply =
      BrowserReply.McpRead(McpReadHandle(envelope.requestId,instance,run,after,limit))
    envelope.operation match {
      case _: Operation.McpTestTools => requireTester(); IO.pure(BrowserReply.McpCatalog(envelope.requestId))
      case Operation.StartMcpTest(instance,run,prompt) =>
        requireTester()
        runs.start(identity,connection,instance,run,prompt).as(read(instance,run,0L,initialReadLimit))
      case Operation.ReadMcpTest(instance,run,after,limit) =>
        requireTester()
        Check(after>=0 && limit>=1 && limit<=McpRunLimits.maximumReadEvents,"invalid","invalid event page bounds")
        IO.pure(read(instance,run,after,limit))
      case Operation.CancelMcpTest(instance,run) =>
        requireTester()
        runs.cancel(identity,instance,run).as(read(instance,run,0L,initialReadLimit))
      case _ => ordinary(identity,envelope,version).map(result => BrowserReply.Ordinary(ServerEnvelope(envelope.requestId,result)))
    }
  }

  /** Called only when the socket's outgoing stream pulls a queued handle. */
  def materialize(reply: BrowserReply,currentIdentity: IO[Identity],version: String,protocol: VersionedWire): IO[Json] = IO.defer { reply match {
    case BrowserReply.Ordinary(envelope) => IO(protocol.encodeServer(version,envelope))
    case BrowserReply.McpCatalog(id) =>
      Check(wire.supportedVersions.contains(version),"version-mismatch","MCP testing requires API 1.4.0 or 1.5.0")
      currentIdentity.flatMap(runs.catalog).map(value => wire.encode(ServerEnvelope(id,wire.catalog(value)),version))
    case BrowserReply.McpRead(handle) =>
      Check(wire.supportedVersions.contains(version),"version-mismatch","MCP testing requires API 1.4.0 or 1.5.0")
      currentIdentity.flatMap(identity => runs.read(identity,handle.instanceId,handle.runId,handle.afterSequence,handle.limit))
        .map(value => wire.encode(ServerEnvelope(handle.requestId,wire.snapshot(value)),version))
  }}
}
