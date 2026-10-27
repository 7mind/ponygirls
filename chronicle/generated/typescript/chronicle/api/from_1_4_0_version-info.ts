import {VersionInfo as api_VersionInfo} from './VersionInfo.js'
import {VersionInfo as VersionInfo__1_4_0} from './v1_4_0/VersionInfo.js'

export function convert__version_info__from__1_4_0(from: VersionInfo__1_4_0): api_VersionInfo {
    return new api_VersionInfo (
        from.current,
        from.minimum,
        from.supported
    )
}