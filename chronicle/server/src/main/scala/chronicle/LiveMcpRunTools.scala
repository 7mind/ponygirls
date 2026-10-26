package chronicle

import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json

final class LiveMcpRunTools(mcp: Mcp) extends McpRunTools {
  def definitions: List[McpRunToolDefinition] = mcp.definitions
  def invoke(access: McpRunAccess,name: String,arguments: Json,admission: ReadAdmission): IO[Json] =
    access.fresh *> mcp.invoke(ReadAccess(access.fresh,ReadMaterialization.admitted(admission)),name,arguments)
}
