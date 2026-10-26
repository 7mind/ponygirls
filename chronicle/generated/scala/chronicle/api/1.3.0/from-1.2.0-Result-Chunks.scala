import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Chunks__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Result.Chunks, Result.Chunks] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Result.Chunks
      ): Result.Chunks = {
        val result: ChunksResult = conversions.convertWithContext[C, chronicle.api.v1_2_0.ChunksResult, ChunksResult](context, _from.result)
        Result.Chunks(
                result
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Chunks"
  }
}