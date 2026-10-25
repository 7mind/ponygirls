import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package chronicle.api {
  object DomainChronicleApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("chronicle.api", "1.0.0"), _root_.chronicle.api.v1_0_0.BaboonCodecsJson, _root_.chronicle.api.v1_0_0.BaboonCodecsUeba); () }
    locally { register(BaboonDomainVersion("chronicle.api", "1.1.0"), _root_.chronicle.api.BaboonCodecsJson, _root_.chronicle.api.BaboonCodecsUeba); () }
  }
}