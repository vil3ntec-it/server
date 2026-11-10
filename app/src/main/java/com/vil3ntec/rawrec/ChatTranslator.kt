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
 * First Google Translate online (far better with everyday, friendly Persian: «داداش»، «میخام»،
 * «چطوری»); without internet, or when Google does not answer, ML Kit on the phone itself (each
 * language's pack, ~30 MB, downloaded once). Persian messages are never translated (they stay
 * exactly as written). Off the main thread; answers come back through the callbacks (any thread).
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

    // ------------------------------------------------------------ online (Google Translate)

    /** Tests: answers in place of Google (url → response body, null = no answer). */
    @Volatile internal var transport: ((String) -> String?)? = null
    @Volatile private var onlineOffUntil = 0L

    /** 7.9: who translated last — "google" or "phone" — written to the report each time it changes. */
    @Volatile var engine = ""; private set
    private fun used(ctx: Context, e: String) {
        if (e == engine) return
        engine = e
        RecLog.add(ctx, if (e == "google") "translate: by Google Translate" else "translate: by the phone (Google did not answer)")
    }

    /**
     * [text] from [src] ("auto" = found by Google) into [dst]: the translation and the language it
     * was in; null when there is no internet or Google does not answer (then the phone's own
     * translator is used, and Google is left alone for a few minutes).
     */
    private fun online(text: String, src: String, dst: String): Pair<String, String>? {
        if (System.currentTimeMillis() < onlineOffUntil) return null
        val url = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" + enc(src) + "&tl=" + enc(dst) + "&q=" + enc(text)
        val body = try {
            transport?.let { it(url) } ?: run {
                val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 5_000; c.readTimeout = 6_000; c.instanceFollowRedirects = false
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) RawRec")
                val code = c.responseCode
                val t = if (code == 200) c.inputStream.bufferedReader().use { it.readText() } else null
                c.disconnect()
                t
            }
        } catch (_: Exception) { null }
        if (body == null) { onlineOffUntil = System.currentTimeMillis() + 3 * 60_000; return null }
        return try {
            val a = org.json.JSONArray(body)
            val segs = a.getJSONArray(0)
            val sb = StringBuilder()
            for (i in 0 until segs.length()) segs.optJSONArray(i)?.optString(0)?.let { if (it != "null") sb.append(it) }
            val out = sb.toString().trim()
            if (out.isEmpty()) null else out to a.optString(2).ifBlank { src }
        } catch (_: Exception) { null }
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    /** [text] in Persian for the owner; null when it could not be translated (it is shown as it is). */
    fun toPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val key = "fa|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        exec.execute {
            online(text, "auto", "fa")?.let { (out, from) ->
                // 7.7: read as chat is spoken, not as a letter is written
                val r = out.takeIf { from.substringBefore('-') != "fa" && it != text }?.let { PersianCasual.casual(it) }
                if (r != null) synchronized(cache) { cache[key] = r }
                used(ctx, "google")
                done(r); return@execute
            }
            val src = detect(text)
            // The first message in a language waits for that language's one-time download.
            if (src == null || !ensurePair(src, "fa")) { done(null); return@execute }
            val out = try { Tasks.await(client(src, "fa").translate(text), 8, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            if (out != null) used(ctx, "phone")
            val r = out?.trim()?.takeIf { it.isNotEmpty() && it != text }?.let { PersianCasual.casual(it) }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }

    /** The owner's Persian [text] in the chosen language; null when it could not be translated. */
    fun fromPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val target = LiveExtras.trTarget(ctx)
        val key = "$target|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        // 7.7: spoken Persian into the written forms translators know; gamers' words kept in English
        val src = PersianCasual.normalize(text)
        exec.execute {
            online(src, "fa", target)?.let { (out, _) ->
                synchronized(cache) { cache[key] = out }
                used(ctx, "google")
                done(out); return@execute
            }
            if (!ensureReady(target)) { done(null); return@execute }
            val out = try { Tasks.await(client("fa", target).translate(src), 10, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            if (out != null) used(ctx, "phone")
            val r = out?.trim()?.takeIf { it.isNotEmpty() }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }
}
