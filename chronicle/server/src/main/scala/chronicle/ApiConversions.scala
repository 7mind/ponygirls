package chronicle.protocol
import chronicle.api.*
import chronicle.api.{v1_0_0 as v10, v1_1_0 as v11}
import baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

final class Convert__SearchResult__From__1_0_0_V11 extends v11.Convert__SearchResult__From__1_0_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v10.SearchResult): v11.SearchResult =
    v11.SearchResult(from.hits.map(hit => conversions.convertWithContext[C,v10.SearchHit,v11.SearchHit](context,hit)),from.total,v11.SearchCountScope.ExactMatches,None)
}
final class Convert__JobInfo__From__1_1_0 extends chronicle.api.Convert__JobInfo__From__1_1_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v11.JobInfo): JobInfo =
    JobInfo(from.id,from.sessionId,from.revision,conversions.convertWithContext[C,v11.JobState,JobState](context,from.state),from.attempts,from.error,0,None)
}
final class Convert__TokensResult__From__1_1_0 extends chronicle.api.Convert__TokensResult__From__1_1_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v11.TokensResult): TokensResult =
    TokensResult(from.tokens.map(token => ListedToken(conversions.convertWithContext[C,v11.TokenInfo,TokenInfo](context,token),TokenSource.Issued)))
}
final class SearchResultToV1 extends AbstractConversion[v11.SearchResult,v10.SearchResult] {
  def versionFrom="1.1.0"; def versionTo="1.0.0"; def typeId="chronicle.api/:#SearchResult"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v11.SearchResult): v10.SearchResult =
    v10.SearchResult(from.hits.map(hit => conversions.convertWithContext[C,v11.SearchHit,v10.SearchHit](context,hit)),from.total)
}
final class JobInfoToV11 extends AbstractConversion[JobInfo,v11.JobInfo] {
  def versionFrom="1.2.0"; def versionTo="1.1.0"; def typeId="chronicle.api/:#JobInfo"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: JobInfo): v11.JobInfo =
    v11.JobInfo(from.id,from.sessionId,from.revision,conversions.convertWithContext[C,JobState,v11.JobState](context,from.state),from.attempts,from.error)
}
final class TokensResultToV11 extends AbstractConversion[TokensResult,v11.TokensResult] {
  def versionFrom="1.2.0"; def versionTo="1.1.0"; def typeId="chronicle.api/:#TokensResult"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: TokensResult): v11.TokensResult =
    v11.TokensResult(from.tokens.map(token => conversions.convertWithContext[C,TokenInfo,v11.TokenInfo](context,token.info)))
}
