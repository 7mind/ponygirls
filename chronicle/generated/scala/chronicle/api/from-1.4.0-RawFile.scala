import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RawFile__From__1_4_0
    extends AbstractConversion[v1_4_0.RawFile, RawFile] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.RawFile
      ): RawFile = {
        val path: String = _from.path
        val sha256: String = _from.sha256
        val content: String = _from.content
        RawFile(
                path,
                sha256,
                content
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#RawFile"
  }
}