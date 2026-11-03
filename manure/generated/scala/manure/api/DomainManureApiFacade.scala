import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package manure.api {
  object DomainManureApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("manure.api", "1.0.0"), _root_.manure.api.BaboonCodecsJson, _root_.manure.api.BaboonCodecsUeba); () }
  }
}