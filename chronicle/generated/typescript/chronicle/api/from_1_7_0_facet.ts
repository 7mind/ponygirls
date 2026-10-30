import {Facet as api_Facet} from './Facet.js'
import {Facet as Facet__1_7_0} from './v1_7_0/Facet.js'

export function convert__facet__from__1_7_0(from: Facet__1_7_0): api_Facet {
    return new api_Facet (
        from.value,
        from.count
    )
}