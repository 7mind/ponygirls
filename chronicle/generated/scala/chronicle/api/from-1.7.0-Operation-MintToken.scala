import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__MintToken__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.MintToken, Operation.MintToken] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.MintToken
      ): Operation.MintToken = {
        val name: String = _from.name
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, v1_7_0.Scope, Scope](context, e1)).toList
        Operation.MintToken(
                name,
                scopes
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#MintToken"
  }
}