package chronicle
import chronicle.api.*

/** Job operations for tokens (R-f): the account-plane scope OperateJobs, named wherever scopes are strings (Settings, the
  * account API on opt-in, static configuration). It is not a `chronicle.api.Scope` value: typed values never carry it. */
object JobOperations {
  val scope = "OperateJobs"
  val maximumScopes = 16
  /** A requested scope list as typed scopes and whether OperateJobs is given. The original list is validated first —
    * nonempty, at most `maximumScopes`, distinct, each known, Raw and OperateJobs each require Read — and only then split. */
  def scopes(requested: Seq[String]): Option[(List[Scope],Boolean)] = {
    val read=requested.contains(Scope.Read.toString)
    val valid=requested.nonEmpty && requested.size<=maximumScopes && requested.distinct.size==requested.size &&
      requested.forall(name => name==scope || Scope.parse(name).nonEmpty) &&
      (!requested.contains(Scope.Raw.toString) || read) && (!requested.contains(scope) || read)
    Option.when(valid)((requested.filterNot(_==scope).flatMap(Scope.parse).toList,requested.contains(scope)))
  }
}
