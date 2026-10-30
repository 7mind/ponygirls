import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__VersionInfo__From__1_7_0
    extends AbstractConversion[v1_7_0.VersionInfo, VersionInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.VersionInfo
      ): VersionInfo = {
        val current: String = _from.current
        val minimum: String = _from.minimum
        val supported: List[String] = _from.supported.map(e1 => e1).toList
        VersionInfo(
                current,
                minimum,
                supported
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#VersionInfo"
  }
}