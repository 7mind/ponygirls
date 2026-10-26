import {ContentView as api_ContentView} from './ContentView.js'
import {ContentView as ContentView__1_1_0} from './v1_1_0/ContentView.js'

export function convert__content_view__from__1_1_0(from: ContentView__1_1_0): api_ContentView {
    return new api_ContentView (
        from.revision,
        from.generationId
    )
}