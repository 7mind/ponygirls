import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ModelUsageResult__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.ModelUsageResult, ModelUsageResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.ModelUsageResult
      ): ModelUsageResult = {
        val observedat: String = _from.observedAt
        val processstartedat: String = _from.processStartedAt
        val windowstartat: String = _from.windowStartAt
        val windowendat: String = _from.windowEndAt
        val coveredmillis: Int = _from.coveredMillis
        val basis: ModelRateBasis = conversions.convertWithContext[C, chronicle.api.v1_6_0.ModelRateBasis, ModelRateBasis](context, _from.basis)
        val settings: IndexingSettings = conversions.convertWithContext[C, chronicle.api.v1_6_0.IndexingSettings, IndexingSettings](context, _from.settings)
        val samples: List[ModelUsageSlice] = _from.samples.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_6_0.ModelUsageSlice, ModelUsageSlice](context, e1)).toList
        ModelUsageResult(
                observedat,
                processstartedat,
                windowstartat,
                windowendat,
                coveredmillis,
                basis,
                settings,
                samples
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ModelUsageResult"
  }
}