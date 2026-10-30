import {Facet as Facet__1_6_0} from '../v1_6_0/Facet.js'
import {Facet as v1_7_0_Facet} from './Facet.js'

export function convert__facet__from__1_6_0(from: Facet__1_6_0): v1_7_0_Facet {
    return new v1_7_0_Facet (
        from.value,
        from.count
    )
}