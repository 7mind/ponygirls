import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RawResult__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.RawResult, RawResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.RawResult
      ): RawResult = {
        val files: List[RawFile] = _from.files.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_5_0.RawFile, RawFile](context, e1)).toList
        val revision: Int = _from.revision
        RawResult(
                files,
                revision
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#RawResult"
  }
}