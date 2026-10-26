import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__JobInfo__From__1_3_0
    extends AbstractConversion[v1_3_0.JobInfo, JobInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.JobInfo
      ): JobInfo = {
        val id: UUID = _from.id
        val sessionid: UUID = _from.sessionId
        val revision: Int = _from.revision
        val state: JobState = conversions.convertWithContext[C, v1_3_0.JobState, JobState](context, _from.state)
        val attempts: Int = _from.attempts
        val error: Option[String] = _from.error.map(e1 => e1)
        val completedwindows: Int = _from.completedWindows
        val totalwindows: Option[Int] = _from.totalWindows.map(e1 => e1)
        JobInfo(
                id,
                sessionid,
                revision,
                state,
                attempts,
                error,
                completedwindows,
                totalwindows
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#JobInfo"
  }
}