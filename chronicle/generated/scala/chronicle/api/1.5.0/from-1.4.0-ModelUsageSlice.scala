import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ModelUsageSlice__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.ModelUsageSlice, ModelUsageSlice] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.ModelUsageSlice
      ): ModelUsageSlice = {
        val purpose: ModelPurpose = conversions.convertWithContext[C, chronicle.api.v1_4_0.ModelPurpose, ModelPurpose](context, _from.purpose)
        val inflight: Int = _from.inFlight
        val finishedcalls: Long = _from.finishedCalls
        val failedcalls: Long = _from.failedCalls
        val cancelledcalls: Long = _from.cancelledCalls
        val invalidusagecalls: Long = _from.invalidUsageCalls
        val input: TokenRateWindow = conversions.convertWithContext[C, chronicle.api.v1_4_0.TokenRateWindow, TokenRateWindow](context, _from.input)
        val output: Option[TokenRateWindow] = _from.output.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.TokenRateWindow, TokenRateWindow](context, e1))
        val reasoningsubset: Option[TokenRateWindow] = _from.reasoningSubset.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.TokenRateWindow, TokenRateWindow](context, e1))
        ModelUsageSlice(
                purpose,
                inflight,
                finishedcalls,
                failedcalls,
                cancelledcalls,
                invalidusagecalls,
                input,
                output,
                reasoningsubset
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ModelUsageSlice"
  }
}