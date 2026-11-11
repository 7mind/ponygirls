package ontology

import io.circe.{Json, JsonObject}
import java.nio.file.{InvalidPathException, Path}
import ontology.domain.Fault
import scala.concurrent.duration.*

private[ontology] final class ConfigFields private (value: JsonObject, location: String) {
  private val NanosPerMilli = 1.millis.toNanos
  private def fail(name: String): Nothing = throw Fault("config", "invalid configuration field: " + location + "." + name)
  def exact(names: Set[String]): ConfigFields = {
    if (value.keys.toSet != names) fail("<fields>")
    this
  }
  def field(name: String): Json = value(name).getOrElse(fail(name))
  def child(name: String): ConfigFields = ConfigFields(field(name), location + "." + name)
  def string(name: String): String = field(name).asString.getOrElse(fail(name))
  def optionalString(name: String): Option[String] = if (field(name).isNull) None else Some(string(name))
  def boolean(name: String): Boolean = field(name).asBoolean.getOrElse(fail(name))
  def array(name: String): List[Json] = field(name).asArray.map(_.toList).getOrElse(fail(name))
  def strings(name: String): List[String] = array(name).map(_.asString.getOrElse(fail(name)))
  def uniqueStrings(name: String): Set[String] = {
    val entries = strings(name)
    if (entries.distinct.size != entries.size) fail(name)
    entries.toSet
  }
  def long(name: String): Long = {
    val number = field(name).asNumber.getOrElse(fail(name))
    if (!number.toString.matches("-?(0|[1-9][0-9]*)")) fail(name)
    number.toLong.getOrElse(fail(name))
  }
  def int(name: String): Int = {
    val number = long(name)
    if (number < Int.MinValue.toLong || number > Int.MaxValue.toLong) fail(name)
    number.toInt
  }
  def duration(name: String): FiniteDuration = {
    val number = long(name)
    if (number <= 0L || number > Long.MaxValue / NanosPerMilli) fail(name)
    number.millis
  }
  def absolutePath(name: String): Path = {
    val path = try Path.of(string(name)) catch { case _: InvalidPathException => fail(name) }
    if (!path.isAbsolute) fail(name)
    path
  }
  def optionalPath(name: String): Option[Path] = if (field(name).isNull) None else Some(absolutePath(name))
  def enumValue[A](name: String, parse: String => Option[A]): A = parse(string(name)).getOrElse(fail(name))
}
private[ontology] object ConfigFields {
  def apply(value: Json, location: String): ConfigFields = new ConfigFields(value.asObject.getOrElse(throw Fault("config", "configuration object required: " + location)), location)
}
