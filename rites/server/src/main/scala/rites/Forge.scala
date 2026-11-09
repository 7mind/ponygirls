package rites

import io.circe.Json
import java.net.{URI, URLEncoder}
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.time.Duration
import rites.api.ForgeKind
import scala.jdk.CollectionConverters.*

final case class ForgeUser(id: String)
final case class Proposal(remoteId: String, url: String, author: String, source: String, target: String, marker: String)
trait Forge {
  def user(authority: Authority, token: String): ForgeUser
  def create(authority: Authority, token: String, delta: CommitDelta): Proposal
  def get(authority: Authority, token: String, remoteId: String): Option[Proposal]
  def list(authority: Authority, token: String): List[Proposal]
  def close(authority: Authority, token: String, proposal: Proposal): Unit
}
class HttpTransport {
  private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build()
  final case class Reply(status: Int, json: Json)
  private final case class Accepted(status: Int, body: Array[Byte])
  def request(method: String, uri: URI, token: String, payload: Option[Json]): Reply = {
    Check(Set("https", "http").contains(uri.getScheme) && uri.getHost != null && uri.getRawUserInfo == null, "remote-rejected", "invalid endpoint")
    val body = payload.map(_.noSpaces).getOrElse("")
    Check(body.length <= 262144, "remote-rejected", "request too large")
    val content = HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)
    val request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).header("Authorization", "Bearer " + token).header("Accept", "application/json").header("Content-Type", "application/json").header("User-Agent", "rites-coordinator").method(method, content).build()
    var accepted: Option[Accepted] = None
    try {
      val response = client.send(request, HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(), 1048576))
      val bytes = response.body()
      accepted = Some(Accepted(response.statusCode(), bytes))
    } catch {
      case _: InterruptedException => Thread.currentThread().interrupt(); throw DomainError("remote-uncertain", "request interrupted")
      case error: DomainError => throw error
      case scala.util.control.NonFatal(_) => throw DomainError("remote-uncertain", "request outcome unavailable")
    }
    val result = accepted.get
    Check(result.status < 300 || result.status >= 400, "remote-uncertain", "redirect rejected")
    val json = if (result.body.isEmpty) Json.Null else io.circe.parser.parse(new String(result.body, StandardCharsets.UTF_8)).getOrElse(Json.Null)
    Reply(result.status, json)
  }
  def form(uri: URI, fields: List[(String, String)]): Reply = {
    val encoded = fields.map((k, v) => URLEncoder.encode(k, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(v, StandardCharsets.UTF_8)).mkString("&")
    Check(encoded.length <= 65536, "remote-rejected", "OAuth request too large")
    val request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).header("Accept", "application/json").header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(encoded)).build()
    try {
      val response = client.send(request, HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(), 1048576)); val bytes = response.body()
      val json = if (bytes.isEmpty) Json.Null else io.circe.parser.parse(new String(bytes, StandardCharsets.UTF_8)).getOrElse(Json.Null)
      Reply(response.statusCode(), json)
    } catch {
      case _: InterruptedException => Thread.currentThread().interrupt(); throw DomainError("remote-uncertain", "request interrupted")
      case scala.util.control.NonFatal(_) => throw DomainError("remote-uncertain", "OAuth refresh outcome unavailable")
    }
  }
}
final class HttpForge(config: Config, transport: HttpTransport) extends Forge {
  private def escape(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
  private def endpoint(authority: Authority, suffix: String): URI = {
    val forge = config.forge(authority.forge, authority.host); val base = forge.parsed(config.testMode).toString.stripSuffix("/")
    val configured = forge.parsed(config.testMode); val full = URI.create(base + suffix)
    Check(full.getScheme == configured.getScheme && full.getHost == configured.getHost && full.getPort == configured.getPort && full.getRawUserInfo == null, "remote-rejected", "endpoint origin changed"); full
  }
  private def project(authority: Authority): String = escape(authority.project)
  private def call(authority: Authority, method: String, suffix: String, token: String, payload: Option[Json], expected: Set[Int]): Json = {
    val reply = transport.request(method, endpoint(authority, suffix), token, payload)
    Check(expected.contains(reply.status), if (reply.status == 401 || reply.status == 403) "remote-auth" else "remote-rejected", "remote request rejected")
    reply.json
  }
  private def required(cursor: io.circe.ACursor, field: String): String = cursor.get[String](field).getOrElse(throw DomainError("remote-response", "missing field"))
  private def identifier(cursor: io.circe.ACursor, field: String): String = cursor.get[Json](field).toOption.flatMap { value =>
    value.asNumber.flatMap(_.toLong).filter(_ > 0).map(_.toString).orElse(value.asString.filter(id => id.nonEmpty && id.length <= 256 && !id.exists(_.isControl)))
  }.getOrElse(throw DomainError("remote-response", "invalid opaque identifier"))
  private def numberJson(json: Json, field: String): String = identifier(json.hcursor, field)
  def user(authority: Authority, token: String): ForgeUser = {
    val json = call(authority, "GET", "/user", token, None, Set(200)); ForgeUser(identifier(json.hcursor, "id"))
  }
  def create(authority: Authority, token: String, delta: CommitDelta): Proposal = {
    val marker = delta.marker + s"\nbase-target:${authority.baseBranch}"
    authority.forge match {
      case ForgeKind.Github =>
        val payload = Json.obj("title" -> Json.fromString(s"Rites ${authority.rite.id}"), "head" -> Json.fromString(delta.branch), "base" -> Json.fromString(authority.baseBranch), "body" -> Json.fromString(marker))
        val json = call(authority, "POST", s"/repos/${authority.project.split('/').map(escape).mkString("/")}/pulls", token, Some(payload), Set(201))
        val id = numberJson(json, "number")
        get(authority, token, id).getOrElse(throw DomainError("remote-response", "created proposal not verifiable"))
      case ForgeKind.Gitlab =>
        val payload = Json.obj("title" -> Json.fromString(s"Rites ${authority.rite.id}"), "source_branch" -> Json.fromString(delta.branch), "target_branch" -> Json.fromString(authority.baseBranch), "description" -> Json.fromString(marker))
        val json = call(authority, "POST", s"/projects/${project(authority)}/merge_requests", token, Some(payload), Set(201))
        val id = numberJson(json, "iid")
        get(authority, token, id).getOrElse(throw DomainError("remote-response", "created proposal not verifiable"))
    }
  }
  private def githubProposal(json: Json): Proposal = {
    val c = json.hcursor; val head = c.downField("head"); val base = c.downField("base")
    Check(required(head.downField("repo"), "full_name").nonEmpty && required(base.downField("repo"), "full_name").nonEmpty, "remote-response", "missing repository identity")
    Proposal(numberJson(json, "number"), required(c, "html_url"), identifier(c.downField("user"), "id"), required(head, "ref"), required(base, "ref"), required(c, "body"))
  }
  private def gitlabProposal(json: Json): Proposal = {
    val c = json.hcursor
    Check(c.get[Long]("source_project_id").toOption.contains(c.get[Long]("target_project_id").getOrElse(-1L)), "remote-response", "cross-project proposal rejected")
    Proposal(numberJson(json, "iid"), required(c, "web_url"), identifier(c.downField("author"), "id"), required(c, "source_branch"), required(c, "target_branch"), required(c, "description"))
  }
  private def parse(authority: Authority, json: Json): Proposal = if (authority.forge == ForgeKind.Github) githubProposal(json) else gitlabProposal(json)
  private def open(authority: Authority, json: Json): Boolean = json.hcursor.get[String](if (authority.forge == ForgeKind.Github) "state" else "state").contains(if (authority.forge == ForgeKind.Github) "open" else "opened")
  private def sameRepo(authority: Authority, json: Json): Boolean = authority.forge match {
    case ForgeKind.Github => val c = json.hcursor; c.downField("head").downField("repo").get[String]("full_name").contains(authority.project) && c.downField("base").downField("repo").get[String]("full_name").contains(authority.project)
    case ForgeKind.Gitlab => json.hcursor.get[Long]("source_project_id").toOption.nonEmpty && json.hcursor.get[Long]("source_project_id") == json.hcursor.get[Long]("target_project_id")
  }
  def get(authority: Authority, token: String, remoteId: String): Option[Proposal] = {
    Check(remoteId.matches("[0-9]+"), "remote-response", "invalid proposal identity")
    val suffix = if (authority.forge == ForgeKind.Github) s"/repos/${authority.project.split('/').map(escape).mkString("/")}/pulls/$remoteId" else s"/projects/${project(authority)}/merge_requests/$remoteId"
    val reply = transport.request("GET", endpoint(authority, suffix), token, None)
    if (reply.status == 404) None else {
      Check(reply.status == 200, "remote-rejected", "proposal read failed")
      if (open(authority, reply.json) && sameRepo(authority, reply.json)) Some(parse(authority, reply.json)) else None
    }
  }
  def list(authority: Authority, token: String): List[Proposal] = {
    val kind = authority.forge
    val base = if (kind == ForgeKind.Github) s"/repos/${authority.project.split('/').map(escape).mkString("/")}/pulls?state=open&per_page=100&page=" else s"/projects/${project(authority)}/merge_requests?state=opened&per_page=100&page="
    val out = List.newBuilder[Proposal]
    var page = 1; var continue = true
    while (continue && page <= 10) {
      val json = call(authority, "GET", base + page, token, None, Set(200)); val values = json.asArray.getOrElse(throw DomainError("remote-response", "proposal page is not a list"))
      values.foreach(value => if (open(authority, value) && sameRepo(authority, value)) out += parse(authority, value))
      continue = values.size == 100; page += 1
    }
    Check(page <= 10 || !continue, "remote-response", "proposal pagination bound exhausted")
    val result = out.result(); Check(result.map(_.remoteId).distinct.size == result.size, "remote-response", "duplicate proposal identity"); result.take(1000)
  }
  def close(authority: Authority, token: String, proposal: Proposal): Unit = {
    authority.forge match {
      case ForgeKind.Github => call(authority, "PATCH", s"/repos/${authority.project.split('/').map(escape).mkString("/")}/pulls/${proposal.remoteId}", token, Some(Json.obj("state" -> Json.fromString("closed"))), Set(200)); ()
      case ForgeKind.Gitlab => call(authority, "PUT", s"/projects/${project(authority)}/merge_requests/${proposal.remoteId}", token, Some(Json.obj("state_event" -> Json.fromString("close"))), Set(200)); ()
    }
  }
}
