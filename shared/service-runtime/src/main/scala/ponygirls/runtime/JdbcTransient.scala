package ponygirls.runtime

/** Database states that pass without any change on our side, by SQLSTATE. */
object JdbcTransient {
  private val ConnectionClass = "08"
  private val ServerStates = Set("57P01", "57P02", "57P03", "53300")

  /** A new connection cannot be served yet: connection failure (class 08), the server shutting down or starting up
    * (57P01 admin shutdown, 57P02 crash shutdown, 57P03 cannot connect now) or no free connection slot (53300). */
  def connection(sqlState: String): Boolean = sqlState.startsWith(ConnectionClass) || ServerStates.contains(sqlState)
}
