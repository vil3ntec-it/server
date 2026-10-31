package com.vil3ntec.rawrec

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.icu.text.DateFormat
import android.icu.util.ULocale
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.MediaStore
import android.util.Size
import java.util.Date
import java.util.Locale

/** One recording as MediaStore knows it. The file exists once, in Movies/RawRec; nothing is copied. */
data class VideoItem(
    val id: Long,
    val uri: Uri,
    val name: String,
    val dateMs: Long,
    val durationMs: Long,
    val bytes: Long,
    val width: Int,
    val height: Int,
)

/**
 * Reads the recordings from MediaStore (Movies/RawRec). Because the gallery and this list read the
 * same MediaStore rows, deleting a video in the gallery removes it here too.
 */
object VideoLibrary {
    private val collection: Uri get() = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

    fun query(ctx: Context): List<VideoItem> {
        val proj = arrayOf(
            MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.DURATION, MediaStore.Video.Media.SIZE, MediaStore.Video.Media.WIDTH, MediaStore.Video.Media.HEIGHT,
        )
        val out = ArrayList<VideoItem>()
        try {
            ctx.contentResolver.query(
                collection, proj, "${MediaStore.Video.Media.RELATIVE_PATH} LIKE ?", arrayOf("Movies/RawRec%"),
                "${MediaStore.Video.Media.DATE_ADDED} DESC",
            )?.use { c ->
                val iId = c.getColumnIndex(MediaStore.Video.Media._ID)
                val iName = c.getColumnIndex(MediaStore.Video.Media.DISPLAY_NAME)
                val iDate = c.getColumnIndex(MediaStore.Video.Media.DATE_ADDED)
                val iDur = c.getColumnIndex(MediaStore.Video.Media.DURATION)
                val iSize = c.getColumnIndex(MediaStore.Video.Media.SIZE)
                val iW = c.getColumnIndex(MediaStore.Video.Media.WIDTH)
                val iH = c.getColumnIndex(MediaStore.Video.Media.HEIGHT)
                while (c.moveToNext()) {
                    val id = if (iId >= 0) c.getLong(iId) else continue
                    out += VideoItem(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        name = if (iName >= 0) c.getString(iName) ?: "" else "",
                        dateMs = if (iDate >= 0) c.getLong(iDate) * 1000 else 0L,
                        durationMs = if (iDur >= 0) c.getLong(iDur) else 0L,
                        bytes = if (iSize >= 0) c.getLong(iSize) else 0L,
                        width = if (iW >= 0) c.getInt(iW) else 0,
                        height = if (iH >= 0) c.getInt(iH) else 0,
                    )
                }
            }
        } catch (_: Throwable) {}
        return out
    }

    /** Friendly title in the app language: Persian calendar for Persian, e.g. «۹ آبان ۱۴۰۵، ۱۷:۰۲». */
    fun title(item: VideoItem, lang: String): String = try {
        val loc = if (lang == AppLang.EN) ULocale("en_US") else ULocale("fa_IR@calendar=persian")
        DateFormat.getInstanceForSkeleton("yMMMdHHmm", loc).format(Date(if (item.dateMs > 0) item.dateMs else System.currentTimeMillis()))
    } catch (_: Throwable) { item.name.removeSuffix(".mp4") }

    fun duration(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) String.format(Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
        else String.format(Locale.US, "%d:%02d", s / 60, s % 60)
    }

    fun thumbnail(ctx: Context, item: VideoItem, px: Int): Bitmap? =
        try { ctx.contentResolver.loadThumbnail(item.uri, Size(px, px * 9 / 16), null) } catch (_: Throwable) { null }

    /** Average frame rate from the file itself (frames ÷ duration), or null when it can't be read. */
    fun fps(ctx: Context, item: VideoItem): Double? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(ctx, item.uri)
            val frames = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toDoubleOrNull()
            val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()
            if (frames != null && dur != null && dur > 0) frames * 1000 / dur else null
        } catch (_: Throwable) { null } finally { try { r.release() } catch (_: Throwable) {} }
    }

    /** Deletes our own video. Returns false when Android 11+ wants the user to confirm (no longer owned). */
    fun delete(ctx: Context, item: VideoItem): Boolean = try {
        ctx.contentResolver.delete(item.uri, null, null) > 0
    } catch (_: SecurityException) { false }
}
