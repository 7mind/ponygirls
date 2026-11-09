package rites

import io.circe.Json
import java.net.URI
import java.nio.file.Files
import java.util.UUID
import rites.api.*
import scala.collection.mutable

final class HttpForgeTest extends munit.FunSuite {
  private final class FixtureTransport(handler: (String, URI, Option[Json]) => (Int, Json)) extends HttpTransport {
    val requests = mutable.ArrayBuffer.empty[(String, URI)]
    override def request(method: String, uri: URI, token: String, payload: Option[Json]): Reply = {
      requests += method -> uri; val (status, json) = handler(method, uri, payload); Reply(status, json)
    }
  }
  private val runId = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
  private def authority(kind: ForgeKind, host: String): Authority = {
    val repository = RepositoryInfo("repo", "owner", kind, host, "org/project", "main", UUID.randomUUID(), 1, List(GrantInfo("owner", "owner", GrantRole.Owner)))
    val rite = RiteInfo("repo", "site", "* * * * *", "prompt.md", "model", true, 1)
    val run = RunInfo(runId, "repo", "site", RunTrigger.Manual, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", None, None, RunState.Running, None, None, None, None, None)
    Authority(run, "owner", repository, rite, "owner", kind, host, "org/project", "main", VaultCiphertext("fixture", Array.fill(12)(0), Array.fill(16)(0)))
  }
  private def delta: CommitDelta = CommitDelta("rites/repo/site/" + runId, "rites-run:" + runId, "fixture")
  private def config(forges: List[ForgeConfig]): Config = StoreFixture.config(Files.createTempDirectory("rites-http-forge")).copy(forges = forges)
  private def githubProposal: Json = Json.obj("number" -> Json.fromInt(25), "html_url" -> Json.fromString("https://github.com/org/project/pull/25"), "user" -> Json.obj("id" -> Json.fromInt(42)), "head" -> Json.obj("ref" -> Json.fromString(delta.branch), "repo" -> Json.obj("full_name" -> Json.fromString("org/project"))), "base" -> Json.obj("ref" -> Json.fromString("main"), "repo" -> Json.obj("full_name" -> Json.fromString("org/project"))), "body" -> Json.fromString(delta.marker), "state" -> Json.fromString("open"))
  private def gitlabProposal: Json = Json.obj("iid" -> Json.fromInt(7), "web_url" -> Json.fromString("https://git.example.invalid/org/project/-/merge_requests/7"), "author" -> Json.obj("id" -> Json.fromInt(42)), "source_branch" -> Json.fromString(delta.branch), "target_branch" -> Json.fromString("main"), "source_project_id" -> Json.fromInt(1), "target_project_id" -> Json.fromInt(1), "description" -> Json.fromString(delta.marker), "state" -> Json.fromString("opened"))
  test("public GitHub requests use approved API origin while clone/web stays logical host") {
    val transport = new FixtureTransport((_, _, _) => (200, Json.obj("id" -> Json.fromInt(42))))
    val forge = config(List(ForgeConfig(ForgeKind.Github, "github.com", "https://api.github.com", "https://github.com")))
    assertEquals(new HttpForge(forge, transport).user(authority(ForgeKind.Github, "github.com"), "fixture").id, "42")
    assertEquals(transport.requests.head._2.toString, "https://api.github.com/user")
  }
  test("GitHub numeric user and proposal author ids decode opaquely") {
    val transport = new FixtureTransport((method, uri, _) => if (uri.getPath == "/user") (200, Json.obj("id" -> Json.fromInt(42))) else if (method == "POST") (201, Json.obj("number" -> Json.fromInt(25))) else (200, githubProposal))
    val forge = new HttpForge(config(List(ForgeConfig(ForgeKind.Github, "github.com", "https://api.github.com", "https://github.com"))), transport)
    val current = authority(ForgeKind.Github, "github.com"); assertEquals(forge.user(current, "fixture").id, "42"); assertEquals(forge.create(current, "fixture", delta).author, "42")
  }
  test("GitLab numeric user and proposal author ids decode opaquely") {
    val transport = new FixtureTransport((method, uri, _) => if (uri.getPath == "/api/v4/user") (200, Json.obj("id" -> Json.fromInt(42))) else if (method == "POST") (201, Json.obj("iid" -> Json.fromInt(7))) else (200, gitlabProposal))
    val forge = new HttpForge(config(List(ForgeConfig(ForgeKind.Gitlab, "git.example.invalid", "https://git.example.invalid/api/v4", "https://git.example.invalid"))), transport)
    val current = authority(ForgeKind.Gitlab, "git.example.invalid"); assertEquals(forge.user(current, "fixture").id, "42"); assertEquals(forge.create(current, "fixture", delta).author, "42")
  }
  test("identifier decoder rejects noncanonical scalar types and accepts bounded opaque strings") {
    def rejected(value: Json): Unit = {
      val transport = new FixtureTransport((_, _, _) => (200, Json.obj("id" -> value)))
      val forge = new HttpForge(config(List(ForgeConfig(ForgeKind.Gitlab, "git.example.invalid", "https://git.example.invalid/api/v4", "https://git.example.invalid"))), transport)
      intercept[DomainError](forge.user(authority(ForgeKind.Gitlab, "git.example.invalid"), "fixture"))
    }
    rejected(Json.True); rejected(Json.fromDoubleOrNull(4.5)); rejected(Json.fromInt(-1)); rejected(Json.fromInt(0)); rejected(Json.obj("nested" -> Json.fromInt(42)))
    val text = new FixtureTransport((_, _, _) => (200, Json.obj("id" -> Json.fromString("service-account"))))
    val forge = new HttpForge(config(List(ForgeConfig(ForgeKind.Gitlab, "git.example.invalid", "https://git.example.invalid/api/v4", "https://git.example.invalid"))), text)
    assertEquals(forge.user(authority(ForgeKind.Gitlab, "git.example.invalid"), "fixture").id, "service-account")
  }
}
