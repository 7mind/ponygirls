import {RawFile as RawFile__1_6_0} from '../v1_6_0/RawFile.js'
import {RawFile as v1_7_0_RawFile} from './RawFile.js'

export function convert__raw_file__from__1_6_0(from: RawFile__1_6_0): v1_7_0_RawFile {
    return new v1_7_0_RawFile (
        from.path,
        from.sha256,
        from.content
    )
}