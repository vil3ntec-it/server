package com.vil3ntec.rawrec

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * App language, independent of the system language. Persian (right-to-left) is the default even
 * when the phone is set to English. Every component wraps its base context with [wrap]: activity,
 * recording service (notifications, overlays, countdown hint), Quick Settings tile, crash screen.
 * On Android 13+ the choice is also handed to the system (LocaleManager), and a language picked in
 * the system's per-app language settings is adopted.
 */
object AppLang {
    const val FA = "fa"
    const val EN = "en"
    private const val KEY = "app_lang"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    private fun systemAppLocale(ctx: Context): String? {
        if (Build.VERSION.SDK_INT < 33) return null
        return try {
            val l = ctx.getSystemService(LocaleManager::class.java)?.applicationLocales
            if (l == null || l.isEmpty) null else l.get(0)?.language
        } catch (_: Throwable) { null }
    }

    /** "fa" or "en". */
    fun get(ctx: Context): String {
        val p = prefs(ctx)
        val sys = systemAppLocale(ctx)
        if (sys == FA || sys == EN) {
            if (SafePrefs.str(p, KEY) != sys) p.edit().putString(KEY, sys).apply()
            return sys
        }
        return if (SafePrefs.str(p, KEY) == EN) EN else FA
    }

    /** A context whose resources use the app language (and its layout direction). */
    fun wrap(base: Context): Context = try {
        val locale = Locale.forLanguageTag(get(base))
        Locale.setDefault(locale)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(locale)
        cfg.setLayoutDirection(locale)
        base.createConfigurationContext(cfg)
    } catch (_: Throwable) { base }

    /** Android 13+: make the system's per-app language match (first run sets Persian). */
    fun syncSystem(ctx: Context) {
        if (Build.VERSION.SDK_INT < 33) return
        val want = get(ctx)
        if (systemAppLocale(ctx) == want) return
        try { ctx.getSystemService(LocaleManager::class.java)?.applicationLocales = LocaleList.forLanguageTags(want) } catch (_: Throwable) {}
    }

    /** In-app switch: store, tell the system (13+), and rebuild the screen in the new language. */
    fun set(activity: Activity, lang: String) {
        val l = if (lang == EN) EN else FA
        prefs(activity).edit().putString(KEY, l).commit()
        if (Build.VERSION.SDK_INT >= 33) {
            try { activity.getSystemService(LocaleManager::class.java)?.applicationLocales = LocaleList.forLanguageTags(l) } catch (_: Throwable) {}
        }
        activity.recreate()
    }
}
