import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__VersionInfo__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.VersionInfo, VersionInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.VersionInfo
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
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#VersionInfo"
  }
}