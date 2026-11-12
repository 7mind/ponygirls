package ontology

import com.comcast.ip4s.{Ipv4Address, Ipv6Address}
import java.net.URI
import java.util.Locale
import ontology.domain.{Fault, Require}

private[ontology] object CanonicalOrigin {
  private val HttpDefaultPort = 80
  private val HttpsDefaultPort = 443
  def requireSerialized(uri: URI, supplied: String): Unit = {
    val rawHost = uri.getHost
    val host = if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
      val address = Ipv6Address.fromString(rawHost.substring(1, rawHost.length - 1)).getOrElse(throw Fault("config", "invalid origin IPv6 address"))
      "[" + address.toString + "]"
    } else {
      val lower = rawHost.toLowerCase(Locale.ROOT)
      Ipv4Address.fromString(lower) match {
        case Some(address) => address.toString
        case None =>
          val last = lower.stripSuffix(".").split("\\.").last
          Require(!last.matches("[0-9]+|0x[0-9a-f]*"), "config", "canonical origin address required")
          lower
      }
    }
    val defaultPort = if (uri.getScheme == "https") HttpsDefaultPort else HttpDefaultPort
    val port = if (uri.getPort == -1 || uri.getPort == defaultPort) "" else ":" + uri.getPort.toString
    Require(supplied == uri.getScheme + "://" + host + port, "config", "canonical serialized public origin required")
  }
}
