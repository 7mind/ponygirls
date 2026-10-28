import {TokenRateWindow as TokenRateWindow__1_4_0} from '../v1_4_0/TokenRateWindow.js'
import {TokenRateWindow as v1_5_0_TokenRateWindow} from './TokenRateWindow.js'

export function convert__token_rate_window__from__1_4_0(from: TokenRateWindow__1_4_0): v1_5_0_TokenRateWindow {
    return new v1_5_0_TokenRateWindow (
        from.knownTokens,
        from.reportedCalls,
        from.unknownCalls,
        from.tokensPerSecond,
        from.sampleAgeMillis
    )
}