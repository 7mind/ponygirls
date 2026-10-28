import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Session__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.Session, Result.Session] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.Session
      ): Result.Session = {
        val result: SessionResult = conversions.convertWithContext[C, chronicle.api.v1_5_0.SessionResult, SessionResult](context, _from.result)
        Result.Session(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Session"
  }
}