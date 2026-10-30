import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package chronicle.api {
  object DomainChronicleApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("chronicle.api", "1.9.0"), _root_.chronicle.api.BaboonCodecsJson, _root_.chronicle.api.BaboonCodecsUeba); () }
  }
}