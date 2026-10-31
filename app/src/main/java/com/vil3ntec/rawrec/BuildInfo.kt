package com.vil3ntec.rawrec

import android.content.Context

object BuildInfo {
    /** versionName from the installed package, so the report always names the real build. */
    fun version(ctx: Context): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?"
    } catch (_: Exception) { "?" }
}
