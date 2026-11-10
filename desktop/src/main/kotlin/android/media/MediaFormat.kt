package android.media

import java.nio.ByteBuffer

/**
 * Desktop stand-in for Android's MediaFormat: only what the shared RawRec live code reads
 * (RtmpSink, MultiSink). A plain key → value map; the desktop encoder fills it the way Android's does.
 */
class MediaFormat {
    private val values = HashMap<String, Any>()

    fun setString(key: String, v: String) { values[key] = v }
    fun setInteger(key: String, v: Int) { values[key] = v }
    fun setByteBuffer(key: String, v: ByteBuffer) { values[key] = v }
    fun containsKey(key: String) = values.containsKey(key)
    fun getString(key: String): String? = values[key] as? String
    fun getInteger(key: String): Int = values[key] as? Int ?: throw NullPointerException("no $key")
    fun getByteBuffer(key: String): ByteBuffer? = (values[key] as? ByteBuffer)?.duplicate()

    companion object {
        const val KEY_MIME = "mime"
        const val KEY_WIDTH = "width"
        const val KEY_HEIGHT = "height"
        const val KEY_FRAME_RATE = "frame-rate"
        const val KEY_SAMPLE_RATE = "sample-rate"
        const val KEY_CHANNEL_COUNT = "channel-count"
        const val KEY_BIT_RATE = "bitrate"
        const val MIMETYPE_VIDEO_AVC = "video/avc"
        const val MIMETYPE_VIDEO_HEVC = "video/hevc"
        const val MIMETYPE_AUDIO_AAC = "audio/mp4a-latm"

        fun createVideoFormat(mime: String, w: Int, h: Int) = MediaFormat().apply { setString(KEY_MIME, mime); setInteger(KEY_WIDTH, w); setInteger(KEY_HEIGHT, h) }
        fun createAudioFormat(mime: String, rate: Int, ch: Int) = MediaFormat().apply { setString(KEY_MIME, mime); setInteger(KEY_SAMPLE_RATE, rate); setInteger(KEY_CHANNEL_COUNT, ch) }
    }
}
