package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.global.avfilter.avfilter_get_by_name

fun main() {
    for (n in listOf("arnndn", "anlmdn", "afftdn", "agate", "hqdn3d", "atadenoise", "nlmeans", "fftdnoiz", "dctdnoiz", "bilateral", "deblock", "cas", "unsharp", "smartblur", "gradfun", "vaguedenoiser", "removegrain", "pp", "spp", "uspp", "fspp", "pp7", "scale", "zscale", "libplacebo"))
        println("%-14s %s".format(n, if (avfilter_get_by_name(n) != null) "yes" else "-"))
}
