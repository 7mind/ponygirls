package manure

import cats.effect.{IO,Resource}
import io.circe.{Json,parser}
import java.io.ByteArrayOutputStream
import java.net.{Proxy,ProxySelector,SocketAddress,URI}
import java.net.http.{HttpClient,HttpRequest,HttpResponse}
import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction,StandardCharsets}
import java.nio.file.Path
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.time.Duration
import java.util.concurrent.{CompletableFuture,CompletionStage,Executors,Flow,TimeUnit}
import javax.net.ssl.{SSLContext,TrustManagerFactory}
import manure.storage.ConfinedDirectory
import ponygirls.runtime.BoundedSecretFile
import scala.jdk.CollectionConverters.*
import scala.util.control.NonFatal

final case class KubernetesRootConfig(apiOrigin: URI,caFile: Path,tokenFile: Path,podUidFile: Path,
  namespace: String,podName: String,containerName: String,expectedCsiDriver: String):
  Require(RootVolume.validDriver(expectedCsiDriver),"config")
  Require(apiOrigin.getScheme == "https" && apiOrigin.getHost != null && apiOrigin.getUserInfo == null &&
    apiOrigin.getRawQuery == null && apiOrigin.getRawFragment == null && Set("","/").contains(apiOrigin.getPath) &&
    (apiOrigin.getPort == -1 || apiOrigin.getPort >= 1 && apiOrigin.getPort <= 65535),"config")
  Require(Vector(caFile,tokenFile,podUidFile).forall(path => path.isAbsolute && path.normalize() == path) &&
    Vector(tokenFile,podUidFile).forall(p => !p.startsWith(Path.of("/nix/store"))),"config")
  Require(Vector(namespace,containerName).forall(_.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")) &&
    podName.matches("[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?"),"config")

object KubernetesRootConfig:
  def parse(value: Json): KubernetesRootConfig =
    Require(value.asObject.exists(_.keys.toSet == Set("kind","api_origin","ca_file","token_file","pod_uid_file","namespace","pod_name","container_name","expected_csi_driver")),"config")
    def text(key: String): String = value.hcursor.get[String](key).fold(_ => throw DomainError("config"),identity)
    Require(text("kind") == "kubernetes-csi-v1","config")
    try KubernetesRootConfig(URI.create(text("api_origin")),Path.of(text("ca_file")),Path.of(text("token_file")),
      Path.of(text("pod_uid_file")),text("namespace"),text("pod_name"),text("container_name"),text("expected_csi_driver"))
    catch case NonFatal(_) => throw DomainError("config")

private[manure] object RootAuthorityJson:
  def child(value: Json,key: String): Json = value.hcursor.downField(key).focus.getOrElse(throw DomainError("authority-unavailable"))
  def text(value: Json,key: String): String = child(value,key).asString.getOrElse(throw DomainError("authority-unavailable"))
  def array(value: Json,key: String): Vector[Json] = child(value,key).asArray.getOrElse(throw DomainError("authority-unavailable"))
  def defaultFalse(value: Json,key: String): Boolean = value.hcursor.downField(key).focus match
    case None => false
    case Some(flag) => flag.asBoolean.getOrElse(throw DomainError("authority-unavailable"))
  def absent(value: Json,key: String): Boolean = value.hcursor.downField(key).focus.forall(_.isNull)
  def uid(value: Json): String =
    val id=text(value,"uid")
    Require(id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),"authority-unavailable");id
  def decode(bytes: Array[Byte]): Json =
    val text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString
    parser.parse(text).fold(_ => throw DomainError("authority-unavailable"),identity)

trait RootMountVerifier:
  def verify(root: ConfinedDirectory,dataRoot: Path,mountPath: Path): Unit

final class KernelRootMounts(mountInfoFile: Path) extends RootMountVerifier:
  private final case class Mount(root: Path,path: Path,major: Long,minor: Long,kind: String,
    options: Set[String],superOptions: Set[String],optionalFields: Set[String])
  private def unescape(value: String): String = value.replace("\\040"," ").replace("\\011","\t").replace("\\012","\n").replace("\\134","\\")
  def verify(root: ConfinedDirectory,dataRoot: Path,mountPath: Path): Unit =
    val observed=root.filesystemIdentity
    val mounted=root.filesystemIdentityAt(mountPath)
    Require(observed == mounted,"authority-mismatch")
    val entries=BoundedSecretFile.read(mountInfoFile,1024*1024).linesIterator.map { line =>
      val sides=line.split(" - ",-1);Require(sides.length == 2,"authority-unavailable")
      val left=sides(0).split(" ",-1);val right=sides(1).split(" ",-1)
      Require(left.length >= 6 && right.length == 3,"authority-unavailable")
      val device=left(2).split(":",-1);Require(device.length == 2,"authority-unavailable")
      Mount(Path.of(unescape(left(3))),Path.of(unescape(left(4))),device(0).toLong,device(1).toLong,right(0),
        left(5).split(",").toSet,right(2).split(",").toSet,left.drop(6).toSet)
    }.filter(entry => dataRoot.startsWith(entry.path)).toVector
    Require(entries.nonEmpty,"authority-mismatch")
    val longest=entries.map(_.path.getNameCount).max
    val selected=entries.filter(_.path.getNameCount == longest)
    Require(selected.size == 1,"authority-mismatch")
    val entry=selected.head
    val kind=observed.kind match
      case 0xef53L => "ext4"
      case 0x58465342L => "xfs"
      case _ => throw DomainError("authority-unavailable")
    Require(entry.root == Path.of("/") && entry.optionalFields.subsetOf(Set("unbindable")) &&
      entry.path == mountPath && entry.major == observed.deviceMajor && entry.minor == observed.deviceMinor &&
      entry.kind == kind && entry.options.contains("rw") && !entry.options.contains("ro") &&
      entry.superOptions.contains("rw") && !entry.superOptions.contains("ro"),"authority-mismatch")

final class KubernetesRootAuthority private (settings: KubernetesRootConfig,dataRoot: Path,
  mounts: RootMountVerifier,client: HttpClient,executor: java.util.concurrent.ExecutorService) extends RootVolumeAuthority with AutoCloseable:
  import RootAuthorityJson.*
  private val ResponseBytes=65536
  private val RequestSeconds=5L
  private val ObservationSeconds=15L
  private def named(values: Vector[Json],name: String): Json =
    val selected=values.filter(value => text(value,"name") == name)
    Require(selected.size == 1,"authority-mismatch");selected.head
  private def metadata(value: Json,kind: String,name: String,namespace: Option[String]): Json =
    Require(text(value,"apiVersion") == "v1" && text(value,"kind") == kind,"authority-unavailable")
    val meta=child(value,"metadata")
    Require(text(meta,"name") == name && namespace.forall(_ == text(meta,"namespace")) && absent(meta,"deletionTimestamp"),"authority-mismatch")
    uid(meta);meta
  private def mountFor(container: Json,path: Path): Json =
    val candidates=array(container,"volumeMounts").filter { mount =>
      val base=Path.of(text(mount,"mountPath"));Require(base.isAbsolute && base.normalize() == base,"authority-unavailable")
      path.startsWith(base)
    }
    Require(candidates.nonEmpty,"authority-mismatch")
    val depth=candidates.map(m => Path.of(text(m,"mountPath")).getNameCount).max
    val matches=candidates.filter(m => Path.of(text(m,"mountPath")).getNameCount == depth)
    Require(matches.size == 1,"authority-mismatch")
    val mount=matches.head
    Require(absent(mount,"subPath") && absent(mount,"subPathExpr") &&
      (absent(mount,"mountPropagation") || text(mount,"mountPropagation") == "None"),"authority-mismatch")
    mount
  private def projected(podSpec: Json,container: Json,file: Path,field: String): Unit =
    val mount=mountFor(container,file)
    Require(defaultFalse(mount,"readOnly"),"authority-mismatch")
    val relative=Path.of(text(mount,"mountPath")).relativize(file).toString
    val volume=named(array(podSpec,"volumes"),text(mount,"name"))
    val sources=array(child(volume,"projected"),"sources")
    val accepted=if field == "token" then sources.count { source =>
      source.hcursor.downField("serviceAccountToken").focus.exists(value => text(value,"path") == relative)
    } else sources.flatMap(_.hcursor.downField("downwardAPI").focus.toVector).flatMap(value => array(value,"items")).count { item =>
      text(item,"path") == relative && text(child(item,"fieldRef"),"fieldPath") == "metadata.uid"
    }
    Require(accepted == 1,"authority-mismatch")
  private def filesystem(volume: Json): Unit =
    val spec=child(volume,"spec")
    Require(absent(spec,"volumeMode") || text(spec,"volumeMode") == "Filesystem","authority-mismatch")
    val modes=array(spec,"accessModes").map(_.asString.getOrElse(throw DomainError("authority-unavailable")))
    Require(modes == Vector("ReadWriteOnce") || modes == Vector("ReadWriteOncePod"),"authority-mismatch")
    Require(text(child(volume,"status"),"phase") == "Bound","authority-mismatch")

  private final class LimitedBody extends HttpResponse.BodySubscriber[Array[Byte]]:
    private val result=new CompletableFuture[Array[Byte]]()
    private val output=new ByteArrayOutputStream()
    private var subscription: Option[Flow.Subscription]=None
    def getBody(): CompletionStage[Array[Byte]] = result
    def onSubscribe(value: Flow.Subscription): Unit =
      subscription=Some(value);value.request(1L)
    def onNext(values: java.util.List[ByteBuffer]): Unit =
      val size=values.asScala.map(_.remaining().toLong).sum
      if size > ResponseBytes-output.size() then
        subscription.get.cancel();result.completeExceptionally(DomainError("authority-unavailable"));()
      else
        values.asScala.foreach { buffer =>
          val bytes=new Array[Byte](buffer.remaining());buffer.get(bytes);output.write(bytes)
        }
        subscription.get.request(1L)
    def onError(error: Throwable): Unit = { result.completeExceptionally(DomainError("authority-unavailable"));() }
    def onComplete(): Unit = { result.complete(output.toByteArray);() }

  private def get(path: String,token: String,end: Long): Json =
    val remaining=math.min(TimeUnit.SECONDS.toNanos(RequestSeconds),end-System.nanoTime())
    Require(remaining > 0,"authority-unavailable")
    val request=HttpRequest.newBuilder(settings.apiOrigin.resolve(path)).timeout(Duration.ofNanos(remaining))
      .header("Accept","application/json").header("Authorization","Bearer " + token).GET().build()
    val future=client.sendAsync(request,(_ : HttpResponse.ResponseInfo) => new LimitedBody)
    try
      val response=future.get(remaining,TimeUnit.NANOSECONDS)
      Require(response.statusCode() == 200,"authority-unavailable")
      decode(response.body())
    finally if !future.isDone then future.cancel(true)

  def observe(root: ConfinedDirectory): RootVolumeWitness =
    try
      val token=BoundedSecretFile.read(settings.tokenFile,16384).stripSuffix("\n").stripSuffix("\r")
      Require(token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"),"authority-unavailable")
      val claims=decode(java.util.Base64.getUrlDecoder.decode(token.split("\\.",-1)(1)))
      val kubernetes=child(claims,"kubernetes.io");val tokenPod=child(kubernetes,"pod")
      val localUid=BoundedSecretFile.read(settings.podUidFile,128).stripSuffix("\n").stripSuffix("\r")
      Require(text(kubernetes,"namespace") == settings.namespace && text(tokenPod,"name") == settings.podName && uid(tokenPod) == localUid,"authority-mismatch")
      val end=System.nanoTime()+TimeUnit.SECONDS.toNanos(ObservationSeconds)
      val podPath=s"/api/v1/namespaces/${settings.namespace}/pods/${settings.podName}"
      val pod=get(podPath,token,end);val podMeta=metadata(pod,"Pod",settings.podName,Some(settings.namespace))
      Require(uid(podMeta) == localUid,"authority-mismatch")
      val spec=child(pod,"spec");val container=named(array(spec,"containers"),settings.containerName)
      projected(spec,container,settings.tokenFile,"token");projected(spec,container,settings.podUidFile,"uid")
      val mount=mountFor(container,dataRoot);Require(!defaultFalse(mount,"readOnly"),"authority-mismatch")
      val mountPath=Path.of(text(mount,"mountPath"));mounts.verify(root,dataRoot,mountPath)
      val claim=child(named(array(spec,"volumes"),text(mount,"name")),"persistentVolumeClaim")
      Require(!defaultFalse(claim,"readOnly"),"authority-mismatch")
      val claimName=text(claim,"claimName");Require(claimName.matches("[a-z0-9][a-z0-9.-]{0,252}"),"authority-unavailable")
      val pvc=get(s"/api/v1/namespaces/${settings.namespace}/persistentvolumeclaims/$claimName",token,end)
      val pvcMeta=metadata(pvc,"PersistentVolumeClaim",claimName,Some(settings.namespace));filesystem(pvc)
      val owners=pvcMeta.hcursor.downField("ownerReferences").focus.map(_.asArray.getOrElse(throw DomainError("authority-unavailable"))).getOrElse(Vector.empty)
      Require(!owners.exists(owner => text(owner,"kind") == "Pod"),"authority-mismatch")
      val volumeName=text(child(pvc,"spec"),"volumeName");Require(volumeName.matches("[a-z0-9][a-z0-9.-]{0,252}"),"authority-unavailable")
      val pv=get(s"/api/v1/persistentvolumes/$volumeName",token,end)
      val pvMeta=metadata(pv,"PersistentVolume",volumeName,None);filesystem(pv)
      val pvSpec=child(pv,"spec");val reference=child(pvSpec,"claimRef")
      Require(uid(reference) == uid(pvcMeta) && text(reference,"name") == claimName && text(reference,"namespace") == settings.namespace,"authority-mismatch")
      val csi=child(pvSpec,"csi");val driver=text(csi,"driver")
      Require(driver == settings.expectedCsiDriver,"authority-mismatch")
      val volume=RootVolume(driver,text(csi,"volumeHandle"))
      val fresh=metadata(get(podPath,token,end),"Pod",settings.podName,Some(settings.namespace))
      Require(uid(fresh) == localUid,"authority-mismatch")
      root.physicalIdentity
      RootVolumeWitness(volume,localUid,uid(pvcMeta),uid(pvMeta),mountPath)
    catch
      case error: DomainError => throw error
      case NonFatal(_) => throw DomainError("authority-unavailable")
  def close(): Unit =
    client.shutdownNow();executor.shutdownNow();()

object KubernetesRootAuthority:
  def resource(settings: KubernetesRootConfig,dataRoot: Path,mounts: RootMountVerifier): Resource[IO,KubernetesRootAuthority] =
    Resource.make(IO.blocking {
      val certificates=CertificateFactory.getInstance("X.509").generateCertificates(new java.io.ByteArrayInputStream(
        BoundedSecretFile.read(settings.caFile,65536).getBytes(StandardCharsets.UTF_8)))
      Require(!certificates.isEmpty,"authority-unavailable")
      val store=KeyStore.getInstance(KeyStore.getDefaultType);store.load(null,null)
      certificates.asScala.zipWithIndex.foreach { (certificate,index) => store.setCertificateEntry("root-"+index,certificate) }
      val trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm);trust.init(store)
      val ssl=SSLContext.getInstance("TLS");ssl.init(null,trust.getTrustManagers,null)
      val executor=Executors.newVirtualThreadPerTaskExecutor()
      try
        val proxy=new ProxySelector:
          def select(uri: URI): java.util.List[Proxy] = java.util.List.of(Proxy.NO_PROXY)
          def connectFailed(uri: URI,address: SocketAddress,error: java.io.IOException): Unit = ()
        val client=HttpClient.newBuilder().sslContext(ssl).proxy(proxy).executor(executor)
          .connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build()
        new KubernetesRootAuthority(settings,dataRoot,mounts,client,executor)
      catch case NonFatal(error) =>
        executor.shutdownNow()
        throw error
    })(authority => IO.blocking(authority.close()))
