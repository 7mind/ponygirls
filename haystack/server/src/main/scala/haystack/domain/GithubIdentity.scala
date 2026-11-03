package haystack.domain

import java.net.{URI, URISyntaxException}
import java.nio.charset.StandardCharsets
import ponygirls.losslessjson.LosslessJson
import ponygirls.losslessjson.LosslessJson.*

final case class GithubRecordFields(
    kind: String,
    nodeId: String,
    url: String,
    title: String,
    summary: String,
    affected: Option[String] = None
)

/** Pure helpers over an already verified, version-pinned GitHub response.
  * No network, credentials, URL-derived identities, shortened hashes or aliases.
  */
object GithubIdentity {
  val IdentityVersion = "github-artifact-v1"
  val TrustedHost = "github.com"
  private def invalid(message: String): Nothing = throw Fault("invalid-document", message)
  private def checkedKind(kind: String): String = kind match {
    case "issue" | "pr" => kind
    case _ => invalid("unsupported GitHub artifact kind")
  }
  def kindFromTypename(typename: String): String = typename match {
    case "Issue" => "issue"
    case "PullRequest" => "pr"
    case _ => invalid("unsupported GitHub typename")
  }
  def digestFor(kind: String, nodeId: String): String = {
    checkedKind(kind)
    if (nodeId.isEmpty) invalid("empty GitHub node id")
    val text = Vector(IdentityVersion, TrustedHost, kind, nodeId).map(JsonText.quote).mkString("[", ",", "]")
    val value = LosslessJson.parse(text, DocumentCodec.Limits).fold(_ => invalid("invalid GitHub node id"), identity)
    OperationDigest.sha256(LosslessJson.encodeUtf8(value))
  }
  def itemComponent(kind: String, nodeId: String): String = "github-" + checkedKind(kind) + "-" + digestFor(kind, nodeId)
  def accountingKey(activityProjectId: String, kind: String, nodeId: String): String =
    QualifiedId.encodeKey(ItemKey(activityProjectId, itemComponent(kind, nodeId)))

  /** Display/provenance only. It is never an endpoint for forwarding credentials. */
  def canonicalUrl(raw: String): String = {
    val uri = try new URI(raw) catch { case _: URISyntaxException => invalid("malformed GitHub URL") }
    if (uri.getScheme != "https" || Option(uri.getHost).forall(!_.equalsIgnoreCase(TrustedHost)) ||
        uri.getRawUserInfo != null || (uri.getPort != -1 && uri.getPort != 443))
      invalid("GitHub URL must use trusted HTTPS host")
    val path = Option(uri.getRawPath).getOrElse("")
    val pattern = "^/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/(issues|pull)/([0-9]+)/?$".r
    path match {
      case pattern(owner, repo, _, _) if owner != "." && owner != ".." && repo != "." && repo != ".." =>
        "https://github.com" + path.stripSuffix("/")
      case _ => invalid("GitHub URL must be an issue or pull URL")
    }
  }

  def accountingDocument(record: GithubRecordFields, importance: String): ItemDocument = {
    val kind = checkedKind(record.kind)
    digestFor(kind, record.nodeId) // Validate the opaque identity without changing it.
    val affected = record.affected.map(v => ",\"affected\":" + JsonText.quote(v)).getOrElse("")
    val fields = "{\"github\":{\"kind\":" + JsonText.quote(kind) + ",\"node_id\":" + JsonText.quote(record.nodeId) +
      ",\"identity_format\":" + JsonText.quote(IdentityVersion) + ",\"url\":" + JsonText.quote(canonicalUrl(record.url)) + affected + "}}"
    val value = LosslessJson.parse(fields, DocumentCodec.Limits).fold(_ => invalid("invalid GitHub record"), identity)
    val result = ItemDocument(record.title, record.summary, value, "github-" + kind, "actual", importance, "required", Vector.empty)
    DocumentCodec.validate(DocumentCodec.toJson(result))
  }

  /** Missing identity is a collision too, not permission to overwrite. */
  def checkStoredIdentity(stored: ItemDocument, kind: String, nodeId: String): Unit = {
    checkedKind(kind)
    digestFor(kind, nodeId)
    def field(value: Value, name: String): Option[Value] = value match {
      case o: Obj => o.fields.find(_._1 == name).map(_._2)
      case _ => None
    }
    def text(value: Option[Value]): Option[String] = value.collect { case s: Str => s.value }
    val gh = field(stored.fields, "github")
    if (stored.docType != "github-" + kind || text(gh.flatMap(field(_, "kind"))) != Some(kind) ||
        text(gh.flatMap(field(_, "node_id"))) != Some(nodeId) ||
        text(gh.flatMap(field(_, "identity_format"))) != Some(IdentityVersion))
      invalid("accounting collision: stored identity differs")
  }
}

/** Opt-in accounting/skill-draft retry discipline, NOT authorization for generic
  * put: authenticated agents and humans can both write all ordinary documents.
  * A helper caller knows the prior writer's type; user IDs alone cannot infer it.
  * New material developments require an explicit reason before rearming attention.
  */
object ProtectedFields {
  def validateAccountingUpdate(
      principal: Principal,
      current: ItemDocument,
      incoming: ItemDocument,
      currentWriterType: String,
      renewedAttentionReason: Option[String] = None
  ): Unit = {
    val protectedTypes = Set("github-issue", "github-pr", "skill-draft")
    if (principal.userType == "agent" && protectedTypes(current.docType)) {
      if (currentWriterType == "human" && DocumentCodec.canonical(current) != DocumentCodec.canonical(incoming))
        throw Fault("invalid-document", "accounting retry would overwrite human edits")
      if (current.humanAttention == "cleared" && incoming.humanAttention == "required" &&
          renewedAttentionReason.forall(_.strip().isEmpty))
        throw Fault("invalid-document", "renewed attention requires a material-development reason")
    }
  }
}
