package manure

import cats.effect.{IO,Resource}
import com.sun.net.httpserver.{HttpExchange,HttpsConfigurator,HttpsServer}
import io.circe.Json
import java.net.{InetSocketAddress,URI}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.security.KeyStore
import java.util.concurrent.{Executors,TimeUnit}
import java.util.concurrent.atomic.{AtomicInteger,AtomicReference}
import javax.net.ssl.{KeyManagerFactory,SSLContext}
import manure.storage.ConfinedDirectory
import scala.util.Using

final case class RootApiDocuments(pod: Json,pvc: Json,pv: Json)
sealed trait RootApiFault
object RootApiFault:
  case object Healthy extends RootApiFault
  final case class Status(value: Int) extends RootApiFault
  case object Oversize extends RootApiFault
  case object StalledBody extends RootApiFault
  case object Redirect extends RootApiFault

final class RootAuthorityFixture(val backend: BackendFixture,val settings: KubernetesRootConfig,
  val documents: AtomicReference[RootApiDocuments],val expectedToken: AtomicReference[String],
  val fault: AtomicReference[RootApiFault],val requests: AtomicInteger):
  val mounts: RootMountVerifier = new RootMountVerifier:
    def verify(root: ConfinedDirectory,dataRoot: Path,mount: Path): Unit =
      Require(root.physicalIdentity.nonEmpty && dataRoot == backend.rootPath && mount == backend.rootPath,"authority-mismatch")
  def authority: Resource[IO,KubernetesRootAuthority] = KubernetesRootAuthority.resource(settings,backend.rootPath,mounts)

object RootAuthorityFixture:
  val PodUid="11111111-1111-4111-8111-111111111111"
  val PvcUid="22222222-2222-4222-8222-222222222222"
  val PvUid="33333333-3333-4333-8333-333333333333"
  def token(uid: String,signature: String): String =
    def encoded(value: Json): String = java.util.Base64.getUrlEncoder.withoutPadding().encodeToString(value.noSpaces.getBytes(UTF_8))
    encoded(Json.obj("alg" -> Json.fromString("fixture")))+"."+encoded(Json.obj("kubernetes.io" -> Json.obj(
      "namespace" -> Json.fromString("owned"),"pod" -> Json.obj("name" -> Json.fromString("core-0"),"uid" -> Json.fromString(uid)))))+"."+signature
  def resource: Resource[IO,RootAuthorityFixture] = withSan("IP:127.0.0.1,DNS:localhost")
  def withSan(certificateSan: String): Resource[IO,RootAuthorityFixture] = for
    backend <- BackendFixture.resource(false)
    directory <- Resource.eval(IO.blocking(Files.createDirectory(backend.rootPath.getParent.resolve("authority"))))
    password="synthetic-fixture-password"
    passwordFile=directory.resolve("store-password")
    storeFile=directory.resolve("keys.p12")
    caFile=directory.resolve("ca.pem")
    _ <- Resource.eval(IO.blocking {
      Files.writeString(passwordFile,password)
      def keytool(arguments: String*): Unit =
        val command=Vector(Path.of(System.getProperty("java.home"),"bin","keytool").toString) ++ arguments
        val process=new ProcessBuilder(command*).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start()
        try Require(process.waitFor(20,TimeUnit.SECONDS) && process.exitValue()==0,"fixture-keytool")
        finally if process.isAlive then process.destroyForcibly()
      keytool("-genkeypair","-alias","fixture","-keyalg","RSA","-keysize","2048","-storetype","PKCS12","-dname","CN=localhost",
        "-ext","SAN="+certificateSan,"-validity","1","-keystore",storeFile.toString,"-storepass:file",passwordFile.toString,"-noprompt")
      keytool("-exportcert","-rfc","-alias","fixture","-keystore",storeFile.toString,"-storepass:file",passwordFile.toString,"-file",caFile.toString)
    })
    ssl <- Resource.eval(IO.blocking {
      val store=KeyStore.getInstance("PKCS12");Using.resource(Files.newInputStream(storeFile))(stream => store.load(stream,password.toCharArray))
      val keys=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm);keys.init(store,password.toCharArray)
      val ssl=SSLContext.getInstance("TLS");ssl.init(keys.getKeyManagers,null,null);ssl
    })
    executor <- Resource.make(IO(Executors.newVirtualThreadPerTaskExecutor()))(value => IO {value.shutdownNow();()})
    server <- Resource.make(IO(HttpsServer.create(new InetSocketAddress("127.0.0.1",0),0)))(value => IO(value.stop(0)))
    fixture <- Resource.eval(IO {
      val tokenFile=directory.resolve("token");val uidFile=directory.resolve("pod-uid")
      val initialToken=token(PodUid,"signature")
      Files.writeString(tokenFile,initialToken);Files.writeString(uidFile,PodUid)
      def text(value: String): Json = Json.fromString(value)
      def meta(name: String,uid: String): Json = Json.obj("name" -> text(name),"namespace" -> text("owned"),"uid" -> text(uid))
      val mount=Json.obj("name" -> text("data"),"mountPath" -> text(backend.rootPath.toString))
      val authMount=Json.obj("name" -> text("authority"),"mountPath" -> text(directory.toString),"readOnly" -> Json.True)
      val pod=Json.obj("apiVersion" -> text("v1"),"kind" -> text("Pod"),"metadata" -> meta("core-0",PodUid),"spec" -> Json.obj(
        "containers" -> Json.arr(Json.obj("name" -> text("manure"),"volumeMounts" -> Json.arr(mount,authMount))),
        "volumes" -> Json.arr(Json.obj("name" -> text("data"),"persistentVolumeClaim" -> Json.obj("claimName" -> text("artifacts"))),
          Json.obj("name" -> text("authority"),"projected" -> Json.obj("sources" -> Json.arr(
            Json.obj("serviceAccountToken" -> Json.obj("path" -> text("token"))),
            Json.obj("downwardAPI" -> Json.obj("items" -> Json.arr(Json.obj("path" -> text("pod-uid"),"fieldRef" -> Json.obj("fieldPath" -> text("metadata.uid"))))))))))))
      val modes=Json.arr(text("ReadWriteOnce"));val status=Json.obj("phase" -> text("Bound"))
      val pvc=Json.obj("apiVersion" -> text("v1"),"kind" -> text("PersistentVolumeClaim"),"metadata" -> meta("artifacts",PvcUid),
        "status" -> status,"spec" -> Json.obj("volumeName" -> text("pv-owned"),"accessModes" -> modes))
      val pv=Json.obj("apiVersion" -> text("v1"),"kind" -> text("PersistentVolume"),"metadata" -> meta("pv-owned",PvUid),"status" -> status,
        "spec" -> Json.obj("accessModes" -> modes,"claimRef" -> meta("artifacts",PvcUid),
          "csi" -> Json.obj("driver" -> text("storage.example.test"),"volumeHandle" -> text("computedisk-original"))))
      val settings=KubernetesRootConfig(URI.create("https://127.0.0.1:"+server.getAddress.getPort),caFile,tokenFile,uidFile,"owned","core-0","manure","storage.example.test")
      val fixture=new RootAuthorityFixture(backend,settings,new AtomicReference(RootApiDocuments(pod,pvc,pv)),new AtomicReference(initialToken),
        new AtomicReference[RootApiFault](RootApiFault.Healthy),new AtomicInteger(0))
      server.setHttpsConfigurator(new HttpsConfigurator(ssl));server.setExecutor(executor)
      server.createContext("/",exchange => {
        fixture.requests.incrementAndGet()
        try
          val authenticated=exchange.getRequestHeaders.getFirst("Authorization") == "Bearer "+fixture.expectedToken.get()
          val documents=fixture.documents.get()
          val selected=exchange.getRequestURI.getPath match
            case "/api/v1/namespaces/owned/pods/core-0" => Some(documents.pod)
            case "/api/v1/namespaces/owned/persistentvolumeclaims/artifacts" => Some(documents.pvc)
            case "/api/v1/persistentvolumes/pv-owned" => Some(documents.pv)
            case _ => None
          val fault=fixture.fault.get()
          val code=if !authenticated then 401 else fault match
            case RootApiFault.Status(status) => status
            case RootApiFault.Redirect => 302
            case _ => if selected.nonEmpty then 200 else 404
          val bytes=if fault == RootApiFault.Oversize then Array.fill[Byte](70000)(65) else selected.getOrElse(Json.obj()).noSpaces.getBytes(UTF_8)
          if fault == RootApiFault.Redirect then exchange.getResponseHeaders.add("Location","https://127.0.0.1:1/do-not-follow")
          exchange.getResponseHeaders.add("Content-Type","application/json")
          exchange.sendResponseHeaders(code,bytes.length.toLong)
          if fault == RootApiFault.StalledBody then Thread.sleep(7000)
          exchange.getResponseBody.write(bytes)
        catch case _: java.io.IOException => ()
        finally exchange.close()
      })
      server.start();fixture
    })
  yield fixture
