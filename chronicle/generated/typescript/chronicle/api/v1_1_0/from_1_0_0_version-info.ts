import {VersionInfo as VersionInfo__1_0_0} from '../v1_0_0/VersionInfo.js'
import {VersionInfo as v1_1_0_VersionInfo} from './VersionInfo.js'

export function convert__version_info__from__1_0_0(from: VersionInfo__1_0_0): v1_1_0_VersionInfo {
    return new v1_1_0_VersionInfo (
        from.current,
        from.minimum,
        from.supported
    )
}