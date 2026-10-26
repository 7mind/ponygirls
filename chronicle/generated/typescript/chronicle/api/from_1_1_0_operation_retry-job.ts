import {Operation_RetryJob as api_Operation_RetryJob} from './Operation.js'
import {Operation_RetryJob as RetryJob__1_1_0} from './v1_1_0/Operation.js'

export function convert__operation__retry_job__from__1_1_0(from: RetryJob__1_1_0): api_Operation_RetryJob {
    return new api_Operation_RetryJob (
        from.jobId
    )
}