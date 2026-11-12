package ontology

import cats.effect.IO
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import scala.util.Using
import ontology.api.*
import ontology.domain.*
import org.eclipse.rdf4j.common.transaction.IsolationLevels
import org.eclipse.rdf4j.model.Literal
import org.eclipse.rdf4j.model.vocabulary.XSD
import org.eclipse.rdf4j.repository.{Repository, RepositoryConnection}

private[ontology] final class RdfStoreIdentity(repository: Repository) {
  private val SupportedFormat = 1
  private val values = repository.getValueFactory
  private val graph = values.createIRI("urn:ontology:store:metadata")
  private val subject = values.createIRI("urn:ontology:store:identity")
  private val predicate = values.createIRI("urn:ontology:store:payload")
  private def target(value: String): Unit = Require(value.trim.nonEmpty && value.length <= Contexts.MaximumTextLength && UTF_8.newEncoder().canEncode(value),
    "projection-target", "bounded UTF-8 projection target required")
  private def read(c: RepositoryConnection): Option[ProjectionStoreIdentity] = {
    val identity = Using.resource(c.getStatements(null, null, null, false, graph)) { rows =>
      if (!rows.hasNext) None
      else {
        val statement = rows.next()
        Require(!rows.hasNext && statement.getSubject == subject && statement.getPredicate == predicate, "corrupt", "invalid projection identity graph shape")
        val text = statement.getObject match {
          case value: Literal if value.getDatatype == XSD.STRING && !value.getLanguage.isPresent => value.stringValue
          case _ => throw Fault("corrupt", "canonical projection identity literal required")
        }
        val value = StoredJson.decode(ProjectionStoreIdentity.codecJson, text)
        Require(value.format == SupportedFormat, "projection-format", "unsupported projection identity format")
        target(value.instance.targetId)
        Some(value)
      }
    }
    Require(identity.nonEmpty || c.isEmpty, "corrupt", "unidentified RDF store contains data")
    identity
  }
  private def transaction[A](write: Boolean)(body: RepositoryConnection => A): IO[A] = IO.blocking {
    Using.resource(repository.getConnection) { c =>
      c.begin(IsolationLevels.SERIALIZABLE)
      val result = body(c)
      if (write) c.commit() else c.rollback()
      result
    }
  }
  private def bind(value: ProjectionStoreIdentity, targetId: String): ProjectionInstance = {
    Require(value.instance.targetId == targetId, "projection-target", "configured target differs from retained RDF identity")
    value.instance
  }
  def open(targetId: String, newIncarnation: IO[UUID]): IO[ProjectionInstance] = IO.defer {
    target(targetId)
    transaction(false)(read).flatMap {
      case Some(value) => IO(bind(value, targetId))
      case None => newIncarnation.flatMap { incarnation => transaction(true) { c =>
        read(c) match {
          case Some(value) => bind(value, targetId)
          case None =>
            val value = ProjectionStoreIdentity(SupportedFormat, ProjectionInstance(targetId, incarnation))
            c.add(subject, predicate, values.createLiteral(StoredJson.encode(ProjectionStoreIdentity.codecJson, value)), graph)
            value.instance
        }
      } }
    }
  }
  def verify(c: RepositoryConnection, expected: ProjectionInstance): Unit =
    Require(read(c).exists(_.instance == expected), "corrupt", "RDF store identity no longer matches its open handle")
}
