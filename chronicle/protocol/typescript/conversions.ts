// Hand-written evolution semantics; generated codecs/converters remain in generated/.
import { JobInfo } from '../../generated/typescript/chronicle/api/v1_2_0/JobInfo.js';
import { JobInfo as JobInfoV11 } from '../../generated/typescript/chronicle/api/v1_1_0/JobInfo.js';
import { convert__job_state__from__1_1_0 } from '../../generated/typescript/chronicle/api/v1_2_0/from_1_1_0_job-state.js';
import { TokenSource } from '../../generated/typescript/chronicle/api/v1_2_0/TokenSource.js';
import { ListedToken } from '../../generated/typescript/chronicle/api/v1_2_0/ListedToken.js';
import { TokensResult } from '../../generated/typescript/chronicle/api/v1_2_0/TokensResult.js';
import { TokensResult as TokensResultV11 } from '../../generated/typescript/chronicle/api/v1_1_0/TokensResult.js';
import { convert__token_info__from__1_1_0 } from '../../generated/typescript/chronicle/api/v1_2_0/from_1_1_0_token-info.js';
import { SearchResult as SearchResultV10 } from '../../generated/typescript/chronicle/api/v1_0_0/SearchResult.js';
import { SearchResult as SearchResultV11 } from '../../generated/typescript/chronicle/api/v1_1_0/SearchResult.js';
import { SearchCountScope } from '../../generated/typescript/chronicle/api/v1_1_0/SearchCountScope.js';
import { convert__search_hit__from__1_0_0 } from '../../generated/typescript/chronicle/api/v1_1_0/from_1_0_0_search-hit.js';
import { ArchiveQuery } from '../../generated/typescript/chronicle/api/ArchiveQuery.js';
import type { ArchiveQuery as ArchiveQueryV17 } from '../../generated/typescript/chronicle/api/v1_7_0/ArchiveQuery.js';
import { ArchiveResult } from '../../generated/typescript/chronicle/api/ArchiveResult.js';
import type { ArchiveResult as ArchiveResultV17 } from '../../generated/typescript/chronicle/api/v1_7_0/ArchiveResult.js';
import { convert__archive_sort__from__1_7_0 } from '../../generated/typescript/chronicle/api/from_1_7_0_archive-sort.js';
import { convert__sort_direction__from__1_7_0 } from '../../generated/typescript/chronicle/api/from_1_7_0_sort-direction.js';
import { convert__archive_row__from__1_7_0 } from '../../generated/typescript/chronicle/api/from_1_7_0_archive-row.js';
import { convert__archive_text_scope__from__1_7_0 } from '../../generated/typescript/chronicle/api/from_1_7_0_archive-text-scope.js';

export function convert__job_info__from__1_1_0(from: JobInfoV11): JobInfo {
  return new JobInfo(from.id, from.sessionId, from.revision, convert__job_state__from__1_1_0(from.state), from.attempts, from.error, 0, undefined);
}
export function convert__tokens_result__from__1_1_0(from: TokensResultV11): TokensResult {
  return new TokensResult(from.tokens.map(info => new ListedToken(convert__token_info__from__1_1_0(info), TokenSource.Issued)));
}
export function convert__search_result__from__1_0_0(from: SearchResultV10): SearchResultV11 {
  return new SearchResultV11(from.hits.map(convert__search_hit__from__1_0_0), from.total, SearchCountScope.ExactMatches, undefined);
}
export function convert__archive_query__from__1_7_0(from: ArchiveQueryV17): ArchiveQuery {
  return new ArchiveQuery(from.expression, convert__archive_sort__from__1_7_0(from.sort), convert__sort_direction__from__1_7_0(from.direction), from.cursor, from.limit, false);
}
export function convert__archive_result__from__1_7_0(from: ArchiveResultV17): ArchiveResult {
  return new ArchiveResult(from.rows.map(convert__archive_row__from__1_7_0), from.total, from.nextCursor, convert__archive_text_scope__from__1_7_0(from.textScope), from.annChunkLimitPerOperand, false);
}
