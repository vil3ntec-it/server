package com.vil3ntec.rawrec

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentifier
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The chat translator: viewers' messages in any other language become Persian for the owner, and
 * what the owner writes in Persian goes out in the language they pick (from the chat itself).
 *
 * Google's ML Kit runs on the phone itself: which language a message is in is found on the phone
 * (no download), and each language's pack (~30 MB) is downloaded once, the first time it is
 * needed; after that it works without internet, at once, with nothing sent anywhere. Persian
 * messages are never translated (they stay exactly as written). Off the main thread; answers come
 * back through the callbacks (any thread).
 */
object ChatTranslator {

    enum class State { OFF, DOWNLOADING, READY, FAILED }

    @Volatile var state = State.OFF; private set
    @Volatile var error: String? = null; private set

    private val exec: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "rawrec-translate").apply { isDaemon = true } }
    private val clients = HashMap<String, Translator>()        // "src>dst"
    private val readyPairs = HashSet<String>()
    private var langId: LanguageIdentifier? = null
    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 400
    }

    /** The common ones first (the settings page shows these as buttons). */
    private val POPULAR = listOf("en", "ar", "tr", "es", "ru", "de", "fr", "pt", "hi", "ur", "it", "ja", "ko", "zh", "id")

    /** Everything ML Kit translates (but Persian), the common ones first. */
    val LANGS: List<String> by lazy {
        val all = (try { TranslateLanguage.getAllLanguages() } catch (_: Throwable) { null }
            ?: listOf("af", "ar", "be", "bg", "bn", "ca", "cs", "cy", "da", "de", "el", "en", "eo", "es", "et", "fi", "fr", "ga", "gl", "gu",
                "he", "hi", "hr", "ht", "hu", "id", "is", "it", "ja", "ka", "kn", "ko", "lt", "lv", "mk", "mr", "ms", "mt", "nl", "no", "pl",
                "pt", "ro", "ru", "sk", "sl", "sq", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "zh")).filter { it != "fa" }
        POPULAR.filter { it in all } + all.filter { it !in POPULAR }.sortedBy { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH) }
    }

    /** The language's name in the app's language (Persian: «انگلیسی»). */
    fun name(ctx: Context, code: String): String {
        val here = ctx.resources.configuration.locales[0]
        return Locale.forLanguageTag(code).getDisplayLanguage(here).ifBlank { code }.replaceFirstChar { it.titlecase(here) }
    }

    /** The language's name in itself («English», «العربية»). */
    fun nativeName(code: String): String {
        val l = Locale.forLanguageTag(code)
        return l.getDisplayLanguage(l).ifBlank { code }.replaceFirstChar { it.titlecase(l) }
    }

    /** Arabic-script letters: Persian (or Arabic / Urdu). */
    fun isPersian(s: String): Boolean = s.any { it in '؀'..'ۿ' || it in 'ﭐ'..'﷿' || it in 'ﹰ'..'﻿' }

    private const val FA_ONLY = "پچژگکی"
    private const val AR_ONLY = "ةيكىإأؤئ"

    /**
     * Worth translating for the owner: words in Latin, Cyrillic, Greek, Hebrew, Indian, Thai, CJK or
     * Korean letters, or Arabic that is clearly not Persian. Persian (and anything unclear in the
     * Persian alphabet) stays as written.
     */
    fun needsPersian(s: String): Boolean {
        val letters = s.count { it.isLetter() }
        if (letters < 2) return false
        if (isPersian(s)) return s.none { it in FA_ONLY } && s.any { it in AR_ONLY } && s.count { it in '؀'..'ۿ' } * 2 >= letters
        val other = s.count { it.isLetter() && it !in '؀'..'ۿ' }
        return other >= 2 && other * 2 >= letters
    }

    /** Downloads the packs for reading (any → Persian) and sending (Persian → the chosen language). */
    fun prepare(ctx: Context, done: ((Boolean) -> Unit)? = null) {
        val target = LiveExtras.trTarget(ctx)
        if (state == State.READY && readyFor == target) { done?.invoke(true); return }
        state = State.DOWNLOADING
        exec.execute { done?.invoke(ensureReady(target)) }
    }

    @Volatile private var readyFor = ""

    /** On the translator thread: English ⇄ Persian and Persian → [target] are there (downloads them once). */
    private fun ensureReady(target: String): Boolean {
        if (state == State.READY && readyFor == target) return true
        state = State.DOWNLOADING
        error = null
        val ok = ensurePair("en", "fa") && (target == "fa" || ensurePair("fa", target))
        if (ok) { readyFor = target; state = State.READY } else state = State.FAILED
        return ok
    }

    /** On the translator thread: the packs for [src] → [dst] (downloaded the first time). */
    private fun ensurePair(src: String, dst: String): Boolean {
        val key = "$src>$dst"
        if (key in readyPairs) return true
        return try {
            Tasks.await(client(src, dst).downloadModelIfNeeded(DownloadConditions.Builder().build()), 10, TimeUnit.MINUTES)
            readyPairs += key
            true
        } catch (t: Throwable) {
            error = (t.cause ?: t).let { it.message ?: it.javaClass.simpleName }
            false
        }
    }

    @Synchronized
    private fun client(src: String, dst: String): Translator = clients.getOrPut("$src>$dst") {
        Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(dst).build())
    }

    /** On the translator thread: the language [text] is written in, or null (unknown / not translatable). */
    private fun detect(text: String): String? {
        val id = try {
            val c = langId ?: LanguageIdentification.getClient().also { langId = it }
            Tasks.await(c.identifyLanguage(text), 3, TimeUnit.SECONDS)
        } catch (_: Throwable) { null }
        val code = id?.substringBefore('-')?.lowercase()
        if (code == "fa") return null
        if (code != null && code != "und" && code in LANGS) return code
        // not sure: Latin letters are most likely English
        val latin = text.count { it in 'a'..'z' || it in 'A'..'Z' }
        return if (latin >= 2 && latin * 2 >= text.count { it.isLetter() }) "en" else null
    }

    /** [text] in Persian for the owner; null when it could not be translated (it is shown as it is). */
    fun toPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val key = "fa|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        exec.execute {
            val src = detect(text)
            // The first message in a language waits for that language's one-time download.
            if (src == null || !ensurePair(src, "fa")) { done(null); return@execute }
            val out = try { Tasks.await(client(src, "fa").translate(text), 8, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            val r = out?.trim()?.takeIf { it.isNotEmpty() && it != text }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }

    /** The owner's Persian [text] in the chosen language; null when it could not be translated. */
    fun fromPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val target = LiveExtras.trTarget(ctx)
        val key = "$target|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        exec.execute {
            if (!ensureReady(target)) { done(null); return@execute }
            val out = try { Tasks.await(client("fa", target).translate(text), 10, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            val r = out?.trim()?.takeIf { it.isNotEmpty() }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }
}
