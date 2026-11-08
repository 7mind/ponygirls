package rites

import com.sun.net.httpserver.{HttpExchange, HttpServer}
import java.net.InetSocketAddress
import java.nio.file.Files
import java.time.{Clock, Instant, ZoneId}
import java.util.UUID
import java.util.concurrent.{CountDownLatch, Executors, TimeUnit}
import java.util.concurrent.atomic.AtomicInteger
import rites.api.*

private final class MutableClock(var value: Instant) extends Clock {
  def getZone: ZoneId = ZoneId.of("UTC"); override def withZone(zone: ZoneId): Clock = this; def instant(): Instant = value
}
private final class TokenFixture(response: Int = 200) extends AutoCloseable {
  val calls = new AtomicInteger(0)
  val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
  server.createContext("/", exchange => {
    calls.incrementAndGet()
    val number = calls.get(); val json = if (response == 200) s"""{"access_token":"new-access-$number","refresh_token":"new-refresh-$number","expires_in":7200,"token_type":"Bearer"}""" else """{"error":"invalid_grant"}"""
    val bytes = json.getBytes(java.nio.charset.StandardCharsets.UTF_8); exchange.getResponseHeaders.add("Content-Type", "application/json"); exchange.sendResponseHeaders(response, bytes.length.toLong)
    try exchange.getResponseBody.write(bytes) finally exchange.close()
  })
  server.start()
  def host = "127.0.0.1"; def port = server.getAddress.getPort
  def close(): Unit = server.stop(0)
}
final class OAuthRefreshTest extends munit.FunSuite {
  private def setup(fixture: TokenFixture, clock: MutableClock, expirySeconds: Int = 200): (MemoryStore, Config, Identity, Authority, OAuthForgeTokens) = {
    val root = Files.createTempDirectory("rites-oauth-refresh"); val base = StoreFixture.config(root)
    val client = OAuthClientConfig("client", fixture.host, "Local fixture", s"http://${fixture.host}:${fixture.port}/oauth/token", "actual-client-id", None, "https://app.example.invalid/callback", 300)
    val config = base.copy(forges = List(ForgeConfig(ForgeKind.Gitlab, fixture.host, s"http://${fixture.host}:${fixture.port}/api/v4", s"http://${fixture.host}:${fixture.port}")), oauthClients = List(client)); config.validate()
    val store = new MemoryStore(config, () => clock.instant()); store.initialize(); val owner = store.login("owner", StoreFixture.plaintext, 3600)._1
    val request = SaveCredentialRequest(None, "OAuth fixture", ForgeKind.Gitlab, fixture.host, "old-access", 0, CredentialMode.Oauth, Some("client"), Some("old-refresh"), Some(clock.instant().plusSeconds(expirySeconds.toLong).toString))
    val credential = store.saveCredential(owner, request, (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, request.secret), Some(StoreFixture.vault.encryptRefresh(user, id, kind.toString, host, request.refreshToken.get))))
    store.saveRepository(owner, SaveRepositoryRequest("repo-oauth", ForgeKind.Gitlab, fixture.host, "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest("repo-oauth", "site", "* * * * *", "prompt.md", "model", true, 0), _ == "model")
    store.manualRun(owner, ManualRunRequest("repo-oauth", "site", UUID.randomUUID())); val authority = store.claimNext(clock.instant()).get
    (store, config, owner, authority, new OAuthForgeTokens(store, StoreFixture.vault, new HttpTransport, config, new CredentialLocks, clock))
  }
  test("refresh rotates both tokens once across concurrent jobs without config-revision churn") {
    val fixture = new TokenFixture; val clock = new MutableClock(Instant.now()); val (store, config, owner, authority, tokens) = setup(fixture, clock)
    try {
      val pool = Executors.newFixedThreadPool(2)
      val first = pool.submit(new java.util.concurrent.Callable[String] { def call(): String = tokens.withToken(authority)(identity) })
      val second = pool.submit(new java.util.concurrent.Callable[String] { def call(): String = tokens.withToken(authority)(identity) })
      assertEquals(first.get(30, TimeUnit.SECONDS), "new-access-1"); assertEquals(second.get(30, TimeUnit.SECONDS), "new-access-1"); pool.shutdownNow()
      assertEquals(fixture.calls.get(), 1); assertEquals(store.credentials(owner).head.revision, authority.repository.revision - 0)
      assertEquals(store.authority(authority.run.id).get.repository.revision, authority.repository.revision)
    } finally { store.close(); fixture.close() }
  }
  test("refresh lease waits for in-flight token use before invalidating old pair") {
    val fixture = new TokenFixture; val clock = new MutableClock(Instant.now()); val (store, config, owner, authority, tokens) = setup(fixture, clock, expirySeconds = 301)
    try {
      val entered = new CountDownLatch(1); val release = new CountDownLatch(1); val pool = Executors.newFixedThreadPool(2)
      val original = clock.instant().plusSeconds(101)
      // Move expiry outside the lead window for the first operation.
      val view = store.credentials(owner).head
      val first = pool.submit(new java.util.concurrent.Callable[Unit] { def call(): Unit = tokens.withToken(authority) { token => entered.countDown(); assert(release.await(30, TimeUnit.SECONDS)); () } })
      assert(entered.await(30, TimeUnit.SECONDS)); clock.value = clock.instant().plusSeconds(2)
      val second = pool.submit(new java.util.concurrent.Callable[String] { def call(): String = tokens.withToken(authority)(identity) })
      Thread.sleep(300); assertEquals(fixture.calls.get(), 0); release.countDown(); first.get(30, TimeUnit.SECONDS); second.get(30, TimeUnit.SECONDS)
      assertEquals(fixture.calls.get(), 1); pool.shutdownNow()
    } finally { store.close(); fixture.close() }
  }
  test("invalid grant requires replacement instead of retrying old pair") {
    val fixture = new TokenFixture(400); val clock = new MutableClock(Instant.now()); val (store, config, owner, authority, tokens) = setup(fixture, clock)
    try {
      assertEquals(intercept[DomainError](tokens.withToken(authority)(identity)).code, "oauth-grant-invalid")
      val health = store.credentials(owner).head.refreshHealth; assertEquals(health, Some(RefreshHealth.Failed))
      assertEquals(intercept[DomainError](tokens.withToken(authority)(identity)).code, "refresh-uncertain"); assertEquals(fixture.calls.get(), 1)
    } finally { store.close(); fixture.close() }
  }
}
