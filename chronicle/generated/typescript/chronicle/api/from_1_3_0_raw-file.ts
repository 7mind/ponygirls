import {RawFile as api_RawFile} from './RawFile.js'
import {RawFile as RawFile__1_3_0} from './v1_3_0/RawFile.js'

export function convert__raw_file__from__1_3_0(from: RawFile__1_3_0): api_RawFile {
    return new api_RawFile (
        from.path,
        from.sha256,
        from.content
    )
}