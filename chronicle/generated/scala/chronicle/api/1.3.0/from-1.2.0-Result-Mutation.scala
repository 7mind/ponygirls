import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Mutation__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Result.Mutation, Result.Mutation] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Result.Mutation
      ): Result.Mutation = {
        val receipt: MutationReceipt = conversions.convertWithContext[C, chronicle.api.v1_2_0.MutationReceipt, MutationReceipt](context, _from.receipt)
        Result.Mutation(
                receipt
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Mutation"
  }
}