import {ContentView as ContentView__1_1_0} from '../v1_1_0/ContentView.js'
import {ContentView as v1_2_0_ContentView} from './ContentView.js'

export function convert__content_view__from__1_1_0(from: ContentView__1_1_0): v1_2_0_ContentView {
    return new v1_2_0_ContentView (
        from.revision,
        from.generationId
    )
}