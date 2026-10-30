import {TokenRateWindow as api_TokenRateWindow} from './TokenRateWindow.js'
import {TokenRateWindow as TokenRateWindow__1_7_0} from './v1_7_0/TokenRateWindow.js'

export function convert__token_rate_window__from__1_7_0(from: TokenRateWindow__1_7_0): api_TokenRateWindow {
    return new api_TokenRateWindow (
        from.knownTokens,
        from.reportedCalls,
        from.unknownCalls,
        from.tokensPerSecond,
        from.sampleAgeMillis
    )
}