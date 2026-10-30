import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenRateWindow__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.TokenRateWindow, TokenRateWindow] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.TokenRateWindow
      ): TokenRateWindow = {
        val knowntokens: Long = _from.knownTokens
        val reportedcalls: Long = _from.reportedCalls
        val unknowncalls: Long = _from.unknownCalls
        val tokenspersecond: Option[Double] = _from.tokensPerSecond.map(e1 => e1)
        val sampleagemillis: Option[Long] = _from.sampleAgeMillis.map(e1 => e1)
        TokenRateWindow(
                knowntokens,
                reportedcalls,
                unknowncalls,
                tokenspersecond,
                sampleagemillis
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#TokenRateWindow"
  }
}