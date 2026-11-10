package com.vil3ntec.rawrec

import android.net.Uri

/** What the shared live code (MediaSink.parts) names; on the desktop the recorder keeps its own list. */
class SegMuxer private constructor() {
    class Part(val index: Int, val uri: Uri, val name: String, val reason: Int) {
        @Volatile var bytes = 0L
        @Volatile var ok = false
        @Volatile var finished = false
    }
}

/** The destinations the shared MultiSink takes (platform, name, server address, key). */
object LiveSettings {
    class Dest(val platform: Int, val name: String, val url: String, val key: String)
}
