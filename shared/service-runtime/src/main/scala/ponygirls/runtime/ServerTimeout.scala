package ponygirls.runtime

/** A timeout a PostgreSQL session enforces on itself: an integer setting in milliseconds, 0 = disabled. */
enum ServerTimeout(val setting: String) {
  case Statement extends ServerTimeout("statement_timeout")
  case Lock extends ServerTimeout("lock_timeout")
  case IdleInTransaction extends ServerTimeout("idle_in_transaction_session_timeout")
}
object ServerTimeout {
  /** One `SELECT` that tightens `timeouts` for the session and never loosens one: each becomes the smaller of its bound
    * and its current value in the session (0, disabled, counts as none). Parameters: one `bigint` per timeout, in order,
    * its bound in milliseconds; it returns one row per timeout.
    *
    * The current value is `current_setting`'s text, which PostgreSQL prints with the largest unit that divides the
    * milliseconds exactly (`0`, `1500ms`, `30s`, `1min`, `1h`, `2d`): each is interval input, whose epoch is the seconds.
    * Not `pg_settings`: that view is `pg_show_all_settings()`, which materialises every setting for the rows read
    * (pgbench on production PostgreSQL 18.7, 2026-11-26, per transaction of the pool's reset and `SELECT 1`: 1.334-1.557 ms
    * read from `pg_settings`, 0.140 ms from `current_setting`). */
  def tightenSession(timeouts: ServerTimeout*): String = tighten(timeouts, local = false)
  /** [[tightenSession]] for the current transaction only, as `SET LOCAL`: until the transaction ends, or the savepoint
    * the statement ran in is rolled back. */
  def tightenTransaction(timeouts: ServerTimeout*): String = tighten(timeouts, local = true)
  private def tighten(timeouts: Seq[ServerTimeout], local: Boolean): String = {
    require(timeouts.nonEmpty, "no timeout to tighten")
    val bounds = timeouts.map(timeout => s"('${timeout.setting}',?::bigint)").mkString(",")
    s"SELECT set_config(v.name,least(coalesce(nullif((extract(epoch from current_setting(v.name)::interval)*1000)::bigint,0),v.bound),v.bound)::text,$local) FROM (VALUES $bounds) v(name,bound)"
  }
}
