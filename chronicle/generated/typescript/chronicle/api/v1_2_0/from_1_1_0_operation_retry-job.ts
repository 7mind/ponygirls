import {Operation_RetryJob as RetryJob__1_1_0} from '../v1_1_0/Operation.js'
import {Operation_RetryJob as v1_2_0_Operation_RetryJob} from './Operation.js'

export function convert__operation__retry_job__from__1_1_0(from: RetryJob__1_1_0): v1_2_0_Operation_RetryJob {
    return new v1_2_0_Operation_RetryJob (
        from.jobId
    )
}