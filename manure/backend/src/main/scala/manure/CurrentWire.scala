package manure

import io.circe.Json
import baboon.runtime.shared.{BaboonCodecContext, BaboonJsonCodec}
import manure.{api => wire}
import java.util.UUID

object CurrentWire:
  val version = "1.0.0"
  val context = BaboonCodecContext.Default
  private val jsonParser = new io.circe.jawn.JawnParser(None, false)
  def parse(value: String): Json = jsonParser.parse(value).getOrElse(throw DomainError("bad-envelope"))
  def encode[A](codec: BaboonJsonCodec[A],value: A): Json = codec.encode(context,value)
  def decode[A](codec: BaboonJsonCodec[A],value: Json): A =
    val decoded = codec.decode(context,value).getOrElse(throw DomainError("bad-envelope"))
    // Generated decoders intentionally tolerate additive fields; this service's
    // sole coordinated contract is CLOSED. Canonical structural equality rejects
    // extras, omitted fields, numeric i64s and alternate ADT envelopes.
    Require(codec.encode(context,decoded) == value, "bad-envelope")
    decoded
  def command(value: Json): wire.ClientEnvelope =
    Require(value.hcursor.get[String]("apiVersion").toOption.contains(version), "unsupported-version")
    decode(wire.ClientEnvelope.codecJson,value)
  def content(value: Json): wire.ContentEnvelope =
    Require(value.hcursor.get[String]("apiVersion").toOption.contains(version), "unsupported-version")
    decode(wire.ContentEnvelope.codecJson,value)
  def requestId(value: Json): UUID = value.hcursor.get[UUID]("requestId").getOrElse(new UUID(0L,0L))
  def error(code: String): wire.Result =
    val name = code.split("-").map(p => p.headOption.map(_.toUpper).getOrElse(' ').toString + p.drop(1)).mkString
    val enumValue = wire.ErrorCode.parse(name).getOrElse(wire.ErrorCode.Unavailable)
    wire.Result.Error(wire.Failure(enumValue,code,if Set("rate-limited","session-limit","unavailable")(code) then Some(5) else None))
  def status(code: String): Int = code match
    case "unauthorized" | "password-required" | "password-invalid" | "grant-required" => 401
    case "forbidden" | "grant-invalid" | "grant-expired" | "session-not-owned" | "tls-required" => 403
    case "not-found" | "dashboard-disabled" => 404
    case "chunk-conflict" | "state-conflict" | "hash-mismatch" | "incomplete-upload" => 409
    case "expired" => 410
    case "too-large" | "quota-exceeded" => 413
    case "rate-limited" | "session-limit" => 429
    case "unavailable" | "search-unavailable" | "search-not-ready" => 503
    case _ => 400
  def kind(value: wire.ArtifactKind): ArtifactKind = if value == wire.ArtifactKind.File then ArtifactKind.File else ArtifactKind.Directory
  def visibility(value: wire.Visibility): Visibility = value match
    case wire.Visibility.Internal => Visibility.Internal
    case wire.Visibility.External => Visibility.External
    case wire.Visibility.Public => Visibility.Public
  def state(value: UploadState): wire.ArtifactState = value match
    case UploadState.Uploading => wire.ArtifactState.Uploading
    case UploadState.Publishing => wire.ArtifactState.Publishing
    case UploadState.Ready => wire.ArtifactState.Ready
  def manifest(value: List[wire.ManifestEntry]): Vector[ManifestEntry] = value.map {
    case wire.ManifestEntry.File(path,size,sha) => ManifestEntry(path,false,size,sha)
    case wire.ManifestEntry.Directory(path) => ManifestEntry(path,true)
  }.toVector
  def manifest(a: Artifact): wire.Manifest = wire.Manifest(a.id,state(a.state),a.manifest.map {
    case e if e.directory => wire.ManifestEntry.Directory(e.path)
    case e => wire.ManifestEntry.File(e.path,e.size,e.sha256)
  }.toList)
  def artifact(a: Artifact,url: String): wire.Artifact = wire.Artifact(a.id,a.name,
    if a.kind == ArtifactKind.File then wire.ArtifactKind.File else wire.ArtifactKind.Directory,
    a.visibility match
      case Visibility.Internal => wire.Visibility.Internal
      case Visibility.External => wire.Visibility.External
      case Visibility.Public => wire.Visibility.Public,
    state(a.state),a.createdByUser,a.createdAt,a.expiresAt,a.totalBytes,a.fileCount.toInt,url)
  def principal(i: Identity): wire.Principal = wire.Principal(i.userId,i.tokenId,if i.userType == "human" then wire.PrincipalType.Human else wire.PrincipalType.Agent)
