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
    val seconds = args.getOrNull(0)?.toIntOrNull() ?: 60
    val twitch = try { topTwitch() } catch (e: Exception) { println("twitch top: ${e.message}"); emptyList() }.ifEmpty { listOf("kaicenat", "xqc", "ibai") }
    println("twitch channels: $twitch")
    val clients = listOf<ChatClient>(YouTubeChat("@LofiGirl")) + twitch.take(3).map { TwitchChat(it) } + listOf("xqc", "adinross").map { KickChat(it) }
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

private fun topTwitch(): List<String> {
    val body = JSONArray().put(JSONObject().put("query", "query{streams(first:5){edges{node{broadcaster{login}}}}}")).toString()
    val r = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI("https://gql.twitch.tv/gql")).header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString())
    val edges = JSONArray(r.body()).getJSONObject(0).getJSONObject("data").getJSONObject("streams").getJSONArray("edges")
    return (0 until edges.length()).map { edges.getJSONObject(it).getJSONObject("node").getJSONObject("broadcaster").getString("login") }
}
