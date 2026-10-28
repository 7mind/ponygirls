package chronicle

object RecordedYoloProfile {
  private val prefix="yolo:"
  def fromRootId(rootId: String): Option[String] = {
    val name=rootId.stripPrefix(prefix)
    Option.when(rootId.startsWith(prefix) && name.matches("[A-Za-z0-9._-]+") && name!="." && name!="..")(name)
  }

  private[chronicle] def sql(source: String): String = {
    val root=s"($source->>'discoveryRootId')"
    val name=s"substring($root FROM ${prefix.length+1})"
    s"CASE WHEN starts_with($root,'$prefix') AND $name<>'' AND $name !~ '[^A-Za-z0-9._-]' AND $name NOT IN ('.','..') THEN $name END"
  }
}
