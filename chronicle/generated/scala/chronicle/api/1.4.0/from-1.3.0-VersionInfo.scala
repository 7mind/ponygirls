import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__VersionInfo__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.VersionInfo, VersionInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.VersionInfo
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
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#VersionInfo"
  }
}