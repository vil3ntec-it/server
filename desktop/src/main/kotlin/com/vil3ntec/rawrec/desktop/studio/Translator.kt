package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.PersianCasual
import org.json.JSONArray
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.Executors

/**
 * Chat in the owner's language, as the phone app does it: Google's translator, then Persian made
 * spoken (casual) not written; the author's name is never sent (only the message), emoji and @names stay.
 * A message already in the owner's language is left alone. When Google does not answer, it is left
 * alone for a few minutes and messages are shown as they are.
 */
object Translator {
    private val exec = Executors.newFixedThreadPool(3) { r -> Thread(r, "translate").apply { isDaemon = true } }
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) { override fun removeEldestEntry(e: MutableMap.MutableEntry<String, String>?) = size > 500 }
    @Volatile private var offUntil = 0L
    @Volatile var lastError: String? = null; private set
    /** For tests: answers instead of Google. */
    @Volatile var transport: ((String) -> String?)? = null

    /** Translates [m] into [to] in the background and updates it in the chat when done. */
    fun translate(m: ChatMessage, to: String) {
        val t = m.text.trim()
        if (t.length < 2 || !t.any { it.isLetter() }) return
        if (to == "fa" && t.any { it in '\u0600'..'\u06FF' } && t.count { it in 'a'..'z' || it in 'A'..'Z' } < t.length / 3) return
        exec.execute {
            val out = text(t, to) ?: return@execute
            ChatHub.update(m.copy(translated = out))
        }
    }

    /** [text] in [to], or null (already in it, or no answer). */
    fun text(text: String, to: String): String? {
        val key = "$to|$text"
        synchronized(cache) { cache[key] }?.let { return it }
        if (System.currentTimeMillis() < offUntil) return null
        val url = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=" + enc(to) + "&q=" + enc(text)
        val body = try {
            transport?.let { it(url) } ?: http.send(HttpRequest.newBuilder(URI(url)).header("User-Agent", ChatClient.UA).timeout(Duration.ofSeconds(6)).GET().build(),
                HttpResponse.BodyHandlers.ofString()).let { if (it.statusCode() == 200) it.body() else { lastError = "Google ${it.statusCode()}"; null } }
        } catch (e: Exception) { lastError = e.message; null }
        if (body == null) { offUntil = System.currentTimeMillis() + 3 * 60_000; return null }
        return try {
            val a = JSONArray(body)
            val segs = a.getJSONArray(0)
            val sb = StringBuilder()
            for (i in 0 until segs.length()) segs.optJSONArray(i)?.optString(0)?.let { if (it != "null") sb.append(it) }
            val from = a.optString(2)
            var out = sb.toString().trim()
            if (out.isEmpty() || out == text || from.substringBefore('-') == to) return null
            if (to == "fa") out = spoken(PersianCasual.casual(out))
            synchronized(cache) { cache[key] = out }
            lastError = null
            out
        } catch (_: Exception) { null }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /**
     * «… است» as it is said: «خوب است» → «خوبه», «خوبی است» → «خوبیه», «خسته است» → «خسته‌ست»,
     * «این‌جا است» → «این‌جاست». Only the separate word «است» (never «هست», never inside a word).
     */
    fun spoken(fa: String): String = Regex("([\\u0600-\\u06FF\\u200C]+)\\s+است(?=$|[\\s.!?،؛؟…])").replace(fa) { m ->
        val w = m.groupValues[1]
        when {
            w.endsWith("ا") || w.endsWith("و") -> w + "ست"
            w.endsWith("ه") && !w.endsWith("ده") -> w + "\u200cست"
            else -> w + "ه"
        }
    }
}
