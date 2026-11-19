package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import cats.effect.IO

/** Query vector for `mode`: a missing client and any provider failure are typed reasons, never provider text. */
object QueryVector {
  def apply(embedding: Option[EmbeddingClient],mode: RetrievalMode,text: String): IO[Option[List[Double]]] =
    if(mode==RetrievalMode.Lexical) IO.pure(None)
    else embedding.fold(IO.raiseError[Option[List[Double]]](RetrievalError.unavailable(UnavailableReason.NotConfigured))) { client =>
      client.query(text).map(Some(_)).handleErrorWith(_ => IO.raiseError(RetrievalError.unavailable(UnavailableReason.EmbeddingFailed)))
    }
}
