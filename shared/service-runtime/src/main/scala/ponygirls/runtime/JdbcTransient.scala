package ponygirls.runtime

/** Database states that pass without any change on our side, by SQLSTATE. */
object JdbcTransient {
  private val ConnectionClass = "08"
  private val ServerStates = Set("57P01", "57P02", "57P03", "53300")
  private val StatementCancelled = "57014"
  private val AdmissionBusy = Set("admission-timeout", "admission-full")

  /** A new connection cannot be served yet: connection failure (class 08), the server shutting down or starting up
    * (57P01 admin shutdown, 57P02 crash shutdown, 57P03 cannot connect now) or no free connection slot (53300). */
  def connection(sqlState: String): Boolean = sqlState.startsWith(ConnectionClass) || ServerStates.contains(sqlState)

  /** A job's transient database failure (restart-robustness spec §4), not charged to its attempts: a connection state
    * above, a cancelled statement (57014: only statement timeouts cancel statements), a full or timed-out admission, and a
    * connection the pool could not supply by its deadline, with or without a SQLSTATE (spec §5 deviation B: a pool wait
    * can end before any login failed). Lock timeouts, serialization failures and every other error are not transient. */
  def job(error: Throwable): Boolean = error match {
    case JdbcFailure(JdbcTransactionEngine.UnavailableCode, _) => true
    case JdbcFailure(_, sqlState) => sqlState.exists(state => state == StatementCancelled || connection(state))
    case RuntimeFailure(code) => AdmissionBusy.contains(code)
    case _ => false
  }
}
