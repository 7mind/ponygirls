package chronicle

import cats.effect.IO
import izumi.distage.model.definition.Lifecycle
import java.util.UUID

final class McpTestRunsResource(tools: McpRunTools,model: McpTestModel,authorization: RunAuthorization,clock: McpRunClock,encoding: McpRunPageEncoding)
  extends Lifecycle.FromPair[IO,McpTestRuns] {
  def acquire: IO[(McpTestRuns,IO[Unit])] = McpTestRuns.resource(tools,model,authorization,clock,encoding,IO(UUID.randomUUID())).allocated
}

final class BrowserControlResource extends Lifecycle.FromPair[IO,BrowserControlAdmission] {
  def acquire: IO[(BrowserControlAdmission,IO[Unit])] = BrowserControlAdmission.resource.allocated
}
