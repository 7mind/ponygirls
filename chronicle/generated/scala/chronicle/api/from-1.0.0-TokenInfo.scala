import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenInfo__From__1_0_0
    extends AbstractConversion[v1_0_0.TokenInfo, TokenInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_0_0.TokenInfo
      ): TokenInfo = {
        val id: UUID = _from.id
        val name: String = _from.name
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, v1_0_0.Scope, Scope](context, e1)).toList
        val createdat: String = _from.createdAt
        val revoked: Boolean = _from.revoked
        TokenInfo(
                id,
                name,
                scopes,
                createdat,
                revoked
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#TokenInfo"
  }
}