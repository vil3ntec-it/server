package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.avformat.AVIOContext
import org.bytedeco.ffmpeg.avformat.AVOutputFormat
import org.bytedeco.ffmpeg.avformat.AVStream
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.avutil.AVRational
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.javacpp.Pointer
import java.io.File

/**
 * Packets into a file. While recording it is Matroska (.mkv): a crash or a pulled cable leaves a file
 * that plays up to the last second, as OBS records. When the recording ends it is copied — not
 * re-encoded — into MP4 for every player and editor; the MKV is kept if that copy fails.
 */
class FileWriter(val file: File, video: AVCodecContext, audio: AVCodecContext?) : AutoCloseable {
    private val oc = AVFormatContext(null as Pointer?)
    private val vst: AVStream
    private val ast: AVStream?
    private val vtb: AVRational = video.time_base()
    private val atb: AVRational? = audio?.time_base()
    private val lock = Any()
    @Volatile var bytes = 0L; private set
    private var open = true

    init {
        check(avformat_alloc_output_context2(oc, null as AVOutputFormat?, null as String?, file.absolutePath) >= 0) { "format for ${file.name}" }
        vst = avformat_new_stream(oc, null)
        check(avcodec_parameters_from_context(vst.codecpar(), video) >= 0)
        vst.time_base(video.time_base())
        ast = audio?.let { a -> avformat_new_stream(oc, null).also { s -> check(avcodec_parameters_from_context(s.codecpar(), a) >= 0); s.time_base(a.time_base()) } }
        val pb = AVIOContext(null as Pointer?)
        val r = avio_open(pb, file.absolutePath, AVIO_FLAG_WRITE)
        check(r >= 0) { "open ${file.absolutePath}: ${VideoDecoder.err(r)}" }
        oc.pb(pb)
        val h = avformat_write_header(oc, null as AVDictionary?)
        check(h >= 0) { "header: ${VideoDecoder.err(h)}" }
    }

    fun writeVideo(p: AVPacket) = write(p, vst, vtb)
    fun writeAudio(p: AVPacket) { ast?.let { write(p, it, atb!!) } }

    private fun write(p: AVPacket, st: AVStream, tb: AVRational) = synchronized(lock) {
        if (!open) return
        bytes += p.size()
        av_packet_rescale_ts(p, tb, st.time_base())
        p.stream_index(st.index())
        val r = av_interleaved_write_frame(oc, p)
        if (r < 0) throw IllegalStateException("write: ${VideoDecoder.err(r)}")
    }

    override fun close() = synchronized(lock) {
        if (!open) return
        open = false
        av_write_trailer(oc)
        avio_closep(oc.pb())
        avformat_free_context(oc)
    }

    companion object {
        /** The MKV copied stream by stream into [mp4] (fast start: plays while still downloading). True when done. */
        fun remux(mkv: File, mp4: File): Boolean {
            val ic = AVFormatContext(null as Pointer?)
            if (avformat_open_input(ic, mkv.absolutePath, null, null) < 0) return false
            val oc = AVFormatContext(null as Pointer?)
            try {
                if (avformat_find_stream_info(ic, null as org.bytedeco.javacpp.PointerPointer<*>?) < 0) return false
                if (avformat_alloc_output_context2(oc, null as AVOutputFormat?, "mp4", mp4.absolutePath) < 0) return false
                for (i in 0 until ic.nb_streams()) {
                    val s = avformat_new_stream(oc, null)
                    avcodec_parameters_copy(s.codecpar(), ic.streams(i).codecpar())
                    s.codecpar().codec_tag(0)
                    s.time_base(ic.streams(i).time_base())
                }
                val pb = AVIOContext(null as Pointer?)
                if (avio_open(pb, mp4.absolutePath, AVIO_FLAG_WRITE) < 0) return false
                oc.pb(pb)
                val opts = AVDictionary(null as Pointer?)
                av_dict_set(opts, "movflags", "+faststart", 0)
                val h = avformat_write_header(oc, opts)
                av_dict_free(opts)
                if (h < 0) return false
                val pkt = av_packet_alloc()
                while (av_read_frame(ic, pkt) >= 0) {
                    val si = pkt.stream_index()
                    av_packet_rescale_ts(pkt, ic.streams(si).time_base(), oc.streams(si).time_base())
                    pkt.pos(-1)
                    av_interleaved_write_frame(oc, pkt)
                    av_packet_unref(pkt)
                }
                av_packet_free(pkt)
                av_write_trailer(oc)
                avio_closep(oc.pb())
                return mp4.length() > 0
            } catch (_: Throwable) {
                return false
            } finally {
                avformat_close_input(ic)
                avformat_free_context(oc)
            }
        }
    }
}
