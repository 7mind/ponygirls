package chronicle

import io.circe.Json

private[chronicle] final case class RevisionSortAnchor(revision: Int,keyHash: String)
private[chronicle] object RevisionSortAnchor {
  private def fingerprint(key: Option[String]): String = Wire.hash(key.fold(Json.Null)(Json.fromString).noSpaces)
  private def validate(anchor: RevisionSortAnchor): Unit =
    Check(anchor.revision>0 && anchor.keyHash.matches("[0-9a-f]{64}"),"invalid","invalid sort cursor anchor")
  def capture(revision: Int,key: Option[String]): RevisionSortAnchor = {
    val anchor=RevisionSortAnchor(revision,fingerprint(key))
    validate(anchor)
    anchor
  }
  def encode(anchor: RevisionSortAnchor): Json = {
    validate(anchor)
    Json.arr(Json.fromInt(anchor.revision),Json.fromString(anchor.keyHash))
  }
  def decode(json: Json): RevisionSortAnchor = {
    val values=json.asArray.getOrElse(throw DomainError("invalid","invalid sort cursor anchor"))
    Check(values.size==2,"invalid","invalid sort cursor anchor")
    val revision=values.head.asNumber.flatMap(_.toInt).getOrElse(throw DomainError("invalid","invalid sort cursor anchor"))
    Check(values.head.noSpaces==revision.toString,"invalid","invalid sort cursor anchor")
    val hash=values(1).asString.getOrElse(throw DomainError("invalid","invalid sort cursor anchor"))
    val anchor=RevisionSortAnchor(revision,hash)
    validate(anchor)
    anchor
  }
  def resolve(anchor: RevisionSortAnchor,key: Option[String]): Option[String] = {
    validate(anchor)
    Check(anchor.keyHash==fingerprint(key),"conflict","sort cursor anchor changed; restart query")
    key
  }
}
