package android.media

/** Desktop stand-in: the buffer flags the shared live code reads (same values as Android's). */
object MediaCodec {
    const val BUFFER_FLAG_KEY_FRAME = 1
    const val BUFFER_FLAG_CODEC_CONFIG = 2
    const val BUFFER_FLAG_END_OF_STREAM = 4
}
