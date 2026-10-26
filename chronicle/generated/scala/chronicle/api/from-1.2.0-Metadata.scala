import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Metadata__From__1_2_0
    extends AbstractConversion[v1_2_0.Metadata, Metadata] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.Metadata
      ): Metadata = {
        val title: String = _from.title
        val project: Option[String] = _from.project.map(e1 => e1)
        val workdir: Option[String] = _from.workdir.map(e1 => e1)
        val gitremote: Option[String] = _from.gitRemote.map(e1 => e1)
        val gitbranch: Option[String] = _from.gitBranch.map(e1 => e1)
        val gitcommit: Option[String] = _from.gitCommit.map(e1 => e1)
        val producer: String = _from.producer
        val model: Option[String] = _from.model.map(e1 => e1)
        val startedat: Option[String] = _from.startedAt.map(e1 => e1)
        val endedat: Option[String] = _from.endedAt.map(e1 => e1)
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        Metadata(
                title,
                project,
                workdir,
                gitremote,
                gitbranch,
                gitcommit,
                producer,
                model,
                startedat,
                endedat,
                tags
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#Metadata"
  }
}