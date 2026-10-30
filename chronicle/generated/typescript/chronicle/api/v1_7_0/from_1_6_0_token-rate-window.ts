import {TokenRateWindow as TokenRateWindow__1_6_0} from '../v1_6_0/TokenRateWindow.js'
import {TokenRateWindow as v1_7_0_TokenRateWindow} from './TokenRateWindow.js'

export function convert__token_rate_window__from__1_6_0(from: TokenRateWindow__1_6_0): v1_7_0_TokenRateWindow {
    return new v1_7_0_TokenRateWindow (
        from.knownTokens,
        from.reportedCalls,
        from.unknownCalls,
        from.tokensPerSecond,
        from.sampleAgeMillis
    )
}