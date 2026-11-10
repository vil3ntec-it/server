package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * The chat readers against the real platforms (CI, open internet): a 24/7 YouTube live, the most watched
 * Twitch channels now, a few big Kick channels; [seconds] of reading, then counts and a few messages
 * (authors shortened). Plus one real translation. Args: seconds.
 */
fun main(args: Array<String>) {
    System.setProperty("rawrec.debugChat", "1")
    val seconds = args.getOrNull(0)?.toIntOrNull() ?: 60
    val twitch = try { topTwitch() } catch (e: Exception) { println("twitch top: ${e.message}"); emptyList() }.ifEmpty { listOf("kaicenat", "xqc", "ibai") }
    println("twitch channels: $twitch")
    // what YouTube and Kick answer this machine (to tell «no live» from «blocked»)
    for (u in listOf("https://www.youtube.com/@LofiGirl/live", "https://kick.com/api/v2/channels/xqc")) try {
        val r = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build().send(HttpRequest.newBuilder(URI(u)).header("User-Agent", ChatClient.UA)
            .header("Cookie", "CONSENT=YES+1; SOCS=CAI").GET().build(), HttpResponse.BodyHandlers.ofString())
        val b = r.body()
        println("probe $u -> ${r.statusCode()} len ${b.length} title=${Regex("<title>([^<]*)").find(b)?.groupValues?.get(1)} canonical=${Regex("rel=\"canonical\" href=\"([^\"]+)").find(b)?.groupValues?.get(1)} " +
            "isLive=${b.contains("\"isLive\":true")} videoDetails=${Regex("\"videoDetails\":\\{\"videoId\":\"([^\"]+)").find(b)?.groupValues?.get(1)} liveChat=${b.contains("liveChatRenderer")} " +
            "bot=${b.contains("confirm you") || b.contains("unusual traffic")} kick_livestream=${Regex("\"livestream\":(null|\\{\"id\":\\d+)").find(b)?.groupValues?.get(1)} chatroom=${Regex("\"chatroom\":\\{\"id\":(\\d+)").find(b)?.groupValues?.get(1)}")
    } catch (e: Exception) { println("probe $u -> ${e.message}") }
    val clients = listOf<ChatClient>(YouTubeChat("@LofiGirl")) + twitch.take(3).map { TwitchChat(it) } + kickLive().ifEmpty { listOf("xqc", "adinross") }.take(2).map { KickChat(it) }
    val firsts = java.util.concurrent.ConcurrentHashMap<Platform, MutableList<ChatMessage>>()
    ChatHub.listeners.add { m -> firsts.getOrPut(m.platform) { java.util.Collections.synchronizedList(ArrayList()) }.let { if (it.size < 4) it.add(m) } }
    clients.forEach { it.start() }
    for (i in 1..seconds) {
        Thread.sleep(1000)
        if (i % 10 == 0) println("t=${i}s " + clients.joinToString(" | ") { "${it.platform.label}/${it.channel}: ${it.received} (${it.status})" })
    }
    clients.forEach { it.close() }
    for (p in Platform.entries) {
        val total = clients.filter { it.platform == p }.sumOf { it.received }
        if (p == Platform.TEST) continue
        println("RESULT ${p.label}: $total messages; paid/gifts: ${ChatHub.newest(200).count { it.platform == p && it.paid }}")
        firsts[p]?.forEach { m -> println("   ${m.author.take(3)}…: ${m.text.take(80)}${m.amount?.let { " [$it]" } ?: ""}") }
    }
    val tr = Translator.text("What a great play, see you all tomorrow!", "fa")
    println("TRANSLATE en→fa: $tr ${Translator.lastError ?: ""}")
    System.exit(0)
}

/** Kick channels live now (its public list), for a test that has someone to read. */
private fun kickLive(): List<String> = try {
    val r = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build().send(HttpRequest.newBuilder(URI("https://kick.com/stream/livestreams/en?page=1&limit=5&sort=desc"))
        .header("User-Agent", ChatClient.UA).header("Accept", "application/json").GET().build(), HttpResponse.BodyHandlers.ofString())
    println("kick live list -> ${r.statusCode()}")
    val d = JSONObject(r.body()).optJSONArray("data") ?: JSONArray()
    (0 until d.length()).mapNotNull { d.getJSONObject(it).optJSONObject("channel")?.optString("slug")?.takeIf { s -> s.isNotBlank() } }.distinct().also { println("kick live: $it") }
} catch (e: Exception) { println("kick live list: ${e.message}"); emptyList() }

private fun topTwitch(): List<String> {
    val body = JSONArray().put(JSONObject().put("query", "query{streams(first:5){edges{node{broadcaster{login}}}}}")).toString()
    val r = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI("https://gql.twitch.tv/gql")).header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString())
    val edges = JSONArray(r.body()).getJSONObject(0).getJSONObject("data").getJSONObject("streams").getJSONArray("edges")
    return (0 until edges.length()).map { edges.getJSONObject(it).getJSONObject("node").getJSONObject("broadcaster").getString("login") }
}
