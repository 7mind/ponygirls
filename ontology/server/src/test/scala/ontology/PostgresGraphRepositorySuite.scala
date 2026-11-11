package ontology

import cats.effect.{IO, Resource}
import ontology.domain.AdmissionEngine
import ponygirls.runtime.{JdbcConfig, JdbcDatabase, JdbcLimits}
import java.nio.file.Path
import scala.concurrent.duration.*

final class PostgresGraphRepositorySuite extends GraphRepositoryContract {
  protected def repository: Resource[IO, GraphRepository] = {
    def required(name: String): String = sys.env.getOrElse(name, throw new IllegalStateException(s"$name required: run ontology/scripts/test-postgres.sh"))
    val config = JdbcConfig(required("ONTOLOGY_TEST_JDBC_URL"), "postgres", Path.of(required("ONTOLOGY_TEST_PASSWORD_FILE")),
      JdbcLimits(4, 16, 10.seconds, 10.seconds, 30.seconds, 35.seconds, 60.seconds, 35.seconds))
    JdbcDatabase.resource(config).evalMap { db =>
      val store = new PostgresGraphRepository(db, new AdmissionEngine)
      store.initialize.as(store: GraphRepository)
    }
  }
}
