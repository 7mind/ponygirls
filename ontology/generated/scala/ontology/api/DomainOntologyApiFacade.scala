import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package ontology.api {
  object DomainOntologyApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("ontology.api", "0.1.0"), _root_.ontology.api.BaboonCodecsJson, _root_.ontology.api.BaboonCodecsUeba); () }
  }
}