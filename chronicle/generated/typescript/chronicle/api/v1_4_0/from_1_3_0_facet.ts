import {Facet as Facet__1_3_0} from '../v1_3_0/Facet.js'
import {Facet as v1_4_0_Facet} from './Facet.js'

export function convert__facet__from__1_3_0(from: Facet__1_3_0): v1_4_0_Facet {
    return new v1_4_0_Facet (
        from.value,
        from.count
    )
}