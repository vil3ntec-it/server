package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.media.MediaMetadataRetriever
import android.net.Uri
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign

/**
 * The picture beside «ظاهرِ ویدیو»: a piece of the owner's own last recording at its real size (1:1,
 * so sharpness shows as it will in the video), left half as recorded, right half with the chosen
 * look. The same math as LookFilter's shader, on the CPU, on a small piece. Before the first
 * recording a drawn test picture stands in.
 */
object LookPreview {
    private var srcKey: String? = null
    private var src: Bitmap? = null
    private var srcFromVideo = false

    /** The piece of the last recording (or the test picture); [fromVideo] says which. */
    @Synchronized
    fun source(ctx: Context, w: Int, h: Int): Pair<Bitmap, Boolean> {
        val prefs = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
        val uri = SafePrefs.str(prefs, RecordService.K_LAST_URIS).split('\n').firstOrNull { it.isNotBlank() }
        val key = "$uri|$w|$h"
        src?.let { if (key == srcKey) return it to srcFromVideo }
        val v = uri?.let { frameOf(ctx, Uri.parse(it), w, h) }
        val b = v ?: pattern(w, h)
        src = b; srcKey = key; srcFromVideo = v != null
        return b to srcFromVideo
    }

    private fun frameOf(ctx: Context, uri: Uri, w: Int, h: Int): Bitmap? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(ctx, uri)
            val durMs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val f = r.getFrameAtTime(durMs * 1000 / 3, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
            // The middle of the picture, pixel for pixel (no scaling: sharpness must look as in the video).
            val cw = min(w, f.width); val ch = min(h, f.height)
            val out = Bitmap.createBitmap(f, (f.width - cw) / 2, (f.height - ch) / 2, cw, ch)
            if (out !== f) f.recycle()
            out
        } catch (_: Throwable) { null } finally { try { r.release() } catch (_: Throwable) {} }
    }

    /** Fine lines, small text, a soft gradient and some colour — where each setting shows. */
    private fun pattern(w: Int, h: Int): Bitmap {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, h.toFloat(), Color.rgb(96, 128, 160), Color.rgb(40, 44, 40), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
        p.shader = null
        p.color = Color.rgb(150, 120, 80); c.drawRect(0f, h * 0.62f, w.toFloat(), h.toFloat(), p)
        p.color = Color.rgb(200, 60, 50); c.drawCircle(w * 0.18f, h * 0.35f, h * 0.12f, p)
        p.color = Color.rgb(60, 140, 80); c.drawRect(w * 0.62f, h * 0.2f, w * 0.85f, h * 0.55f, p)
        p.color = Color.rgb(230, 230, 230); p.strokeWidth = 1f
        for (i in 0 until 24) c.drawLine(w * 0.35f + i * 4, h * 0.15f, w * 0.35f + i * 4, h * 0.5f, p)
        p.textSize = h * 0.05f; p.color = Color.WHITE
        c.drawText("RawRec 0123456789 ABCDEF", w * 0.05f, h * 0.75f, p)
        p.textSize = h * 0.035f; p.color = Color.rgb(200, 200, 200)
        c.drawText("far detail · small text · fine lines", w * 0.05f, h * 0.85f, p)
        return b
    }

    /** Left half as recorded, a thin line, right half with [look]. */
    fun render(source: Bitmap, look: LookFilter.Look): Bitmap {
        val w = source.width; val h = source.height
        val px = IntArray(w * h)
        source.getPixels(px, 0, w, 0, 0, w, h)
        val out = px.copyOf()
        val half = w / 2
        fun lum(i: Int): Float {
            val c = px[i]
            return (0.2126f * ((c shr 16) and 255) + 0.7152f * ((c shr 8) and 255) + 0.0722f * (c and 255)) / 255f
        }
        for (y in 0 until h) for (x in half until w) {
            val i = y * w + x
            val c = px[i]
            var r = ((c shr 16) and 255) / 255f
            var g = ((c shr 8) and 255) / 255f
            var b = (c and 255) / 255f
            val yv = 0.2126f * r + 0.7152f * g + 0.0722f * b
            if (look.sharp > 0f && x in 1 until w - 1 && y in 1 until h - 1) {
                val n = (lum(i - 1) + lum(i + 1) + lum(i - w) + lum(i + w)) * 0.25f
                var d = yv - n
                d = sign(d) * max(abs(d) - 0.012f, 0f)
                val a = (d * look.sharp * 1.6f).coerceIn(-0.07f, 0.07f)
                r += a; g += a; b += a
            }
            if (look.clarity > 0f && x in 3 until w - 3 && y in 3 until h - 3) {
                val m = (lum(i - 3 * w - 3) + lum(i - 3 * w + 3) + lum(i + 3 * w - 3) + lum(i + 3 * w + 3)) * 0.25f
                var d = yv - m
                d = sign(d) * max(abs(d) - 0.008f, 0f)
                val a = (d * look.clarity * 1.3f).coerceIn(-0.09f, 0.09f)
                r += a; g += a; b += a
            }
            r = (r - 0.5f) * look.contrast + 0.5f + look.brightness
            g = (g - 0.5f) * look.contrast + 0.5f + look.brightness
            b = (b - 0.5f) * look.contrast + 0.5f + look.brightness
            val l = 0.2126f * r + 0.7152f * g + 0.0722f * b
            val mx = max(r, max(g, b)); val mn = min(r, min(g, b))
            val s = look.saturation * (1f + look.vibrance * (1f - (mx - mn).coerceIn(0f, 1f)))
            r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s
            r += look.warmth * 0.5f; g += look.warmth * 0.1f; b -= look.warmth * 0.5f
            out[i] = Color.rgb((r.coerceIn(0f, 1f) * 255 + 0.5f).toInt(), (g.coerceIn(0f, 1f) * 255 + 0.5f).toInt(), (b.coerceIn(0f, 1f) * 255 + 0.5f).toInt())
        }
        for (y in 0 until h) { out[y * w + half] = Color.WHITE; if (half + 1 < w) out[y * w + half + 1] = Color.WHITE }
        return Bitmap.createBitmap(out, w, h, Bitmap.Config.ARGB_8888)
    }
}
