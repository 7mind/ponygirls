import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__CollectionStatus__From__1_2_0
    extends AbstractConversion[v1_2_0.Result.CollectionStatus, Result.CollectionStatus] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.Result.CollectionStatus
      ): Result.CollectionStatus = {
        val result: CollectorStatusResult = conversions.convertWithContext[C, v1_2_0.CollectorStatusResult, CollectorStatusResult](context, _from.result)
        Result.CollectionStatus(
                result
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#CollectionStatus"
  }
}