import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RawResult__From__1_0_0
    extends AbstractConversion[v1_0_0.RawResult, RawResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_0_0.RawResult
      ): RawResult = {
        val files: List[RawFile] = _from.files.map(e1 => conversions.convertWithContext[C, v1_0_0.RawFile, RawFile](context, e1)).toList
        val revision: Int = _from.revision
        RawResult(
                files,
                revision
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#RawResult"
  }
}