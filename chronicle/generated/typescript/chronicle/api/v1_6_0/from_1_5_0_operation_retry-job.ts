import {Operation_RetryJob as RetryJob__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_RetryJob as v1_6_0_Operation_RetryJob} from './Operation.js'

export function convert__operation__retry_job__from__1_5_0(from: RetryJob__1_5_0): v1_6_0_Operation_RetryJob {
    return new v1_6_0_Operation_RetryJob (
        from.jobId
    )
}