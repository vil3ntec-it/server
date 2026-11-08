package com.vil3ntec.rawrec

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The chat translator: viewers' messages in another language become Persian for the owner, and
 * what the owner writes in Persian goes out in the channel's language (English by default).
 *
 * Google's ML Kit translation runs on the phone itself: after a one-time download of the Persian
 * language pack (~30 MB) it works without internet, at once, with no limit and nothing sent
 * anywhere. Persian messages are never translated (they stay exactly as written). Off the main
 * thread; answers come back through the callbacks (any thread).
 */
object ChatTranslator {

    enum class State { OFF, DOWNLOADING, READY, FAILED }

    @Volatile var state = State.OFF; private set
    @Volatile var error: String? = null; private set

    private val exec: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "rawrec-translate").apply { isDaemon = true } }
    private var toFa: Translator? = null
    private var fromFa: Translator? = null
    private var fromFaTarget = ""
    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 400
    }

    /** The languages the owner can send in (code, name resource). */
    val TARGETS = listOf(
        TranslateLanguage.ENGLISH to R.string.tr_lang_en,
        TranslateLanguage.ARABIC to R.string.tr_lang_ar,
        TranslateLanguage.TURKISH to R.string.tr_lang_tr,
        TranslateLanguage.SPANISH to R.string.tr_lang_es,
        TranslateLanguage.RUSSIAN to R.string.tr_lang_ru,
    )

    /** Arabic-script letters: Persian (or Arabic / Urdu) — shown as written. */
    fun isPersian(s: String): Boolean = s.any { it in '؀'..'ۿ' || it in 'ﭐ'..'﷿' || it in 'ﹰ'..'﻿' }

    /** Worth translating for the owner: it has Latin words and no Persian. */
    fun needsPersian(s: String): Boolean {
        if (isPersian(s)) return false
        val letters = s.count { it.isLetter() }
        val latin = s.count { it in 'a'..'z' || it in 'A'..'Z' }
        return latin >= 2 && latin * 2 >= letters
    }

    /** Downloads the language packs if needed (once), then [done] with true when ready. */
    fun prepare(ctx: Context, done: ((Boolean) -> Unit)? = null) {
        val target = LiveExtras.trTarget(ctx)
        if (state == State.READY && readyFor == target) { done?.invoke(true); return }
        state = State.DOWNLOADING
        exec.execute { done?.invoke(ensureReady(target)) }
    }

    @Volatile private var readyFor = ""

    /** On the translator thread: the packs for Persian and [target] are there (downloads them once). */
    private fun ensureReady(target: String): Boolean {
        if (state == State.READY && readyFor == target) return true
        state = State.DOWNLOADING
        error = null
        return try {
            Tasks.await(toFaClient().downloadModelIfNeeded(DownloadConditions.Builder().build()), 10, TimeUnit.MINUTES)
            if (target != TranslateLanguage.ENGLISH) {
                Tasks.await(fromFaClient(target).downloadModelIfNeeded(DownloadConditions.Builder().build()), 10, TimeUnit.MINUTES)
            }
            readyFor = target
            state = State.READY
            true
        } catch (t: Throwable) {
            error = (t.cause ?: t).let { it.message ?: it.javaClass.simpleName }
            state = State.FAILED
            false
        }
    }

    /** [text] in Persian for the owner; null when it could not be translated (it is shown as it is). */
    fun toPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val key = "fa|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        val target = LiveExtras.trTarget(ctx)
        exec.execute {
            // The first messages wait for the one-time download; then everything is instant.
            if (!ensureReady(target)) { done(null); return@execute }
            val out = try { Tasks.await(toFaClient().translate(text), 8, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            val r = out?.trim()?.takeIf { it.isNotEmpty() && it != text }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }

    /** The owner's Persian [text] in the channel's language; null when it could not be translated. */
    fun fromPersian(ctx: Context, text: String, done: (String?) -> Unit) {
        val target = LiveExtras.trTarget(ctx)
        val key = "$target|$text"
        synchronized(cache) { cache[key] }?.let { done(it); return }
        exec.execute {
            if (!ensureReady(target)) { done(null); return@execute }
            val out = try { Tasks.await(fromFaClient(target).translate(text), 10, TimeUnit.SECONDS) } catch (_: Throwable) { null }
            val r = out?.trim()?.takeIf { it.isNotEmpty() }
            if (r != null) synchronized(cache) { cache[key] = r }
            done(r)
        }
    }

    @Synchronized
    private fun toFaClient(): Translator = toFa ?: Translation.getClient(TranslatorOptions.Builder()
        .setSourceLanguage(TranslateLanguage.ENGLISH).setTargetLanguage(TranslateLanguage.PERSIAN).build()).also { toFa = it }

    @Synchronized
    private fun fromFaClient(target: String): Translator {
        fromFa?.let { if (fromFaTarget == target) return it; it.close() }
        return Translation.getClient(TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.PERSIAN).setTargetLanguage(target).build()).also { fromFa = it; fromFaTarget = target }
    }
}
