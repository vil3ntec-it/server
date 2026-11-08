package com.vil3ntec.rawrec

/**
 * Twitch chat read without signing in: Twitch lets anyone read a channel's chat over IRC with an
 * anonymous «justinfan» name (sending needs an account, so RawRec only reads Twitch). Plain parsing,
 * tested on the JVM.
 */
object TwitchIrc {
    const val HOST = "irc.chat.twitch.tv"
    const val PORT = 6697

    class Line(val tags: Map<String, String>, val prefix: String, val command: String, val params: List<String>, val trailing: String?) {
        val nick: String get() = prefix.substringBefore('!')
    }

    /** What a line means for RawRec. */
    sealed class Ev {
        data class Ping(val arg: String) : Ev()
        object Reconnect : Ev()
        object Joined : Ev()
        data class Notice(val id: String, val text: String) : Ev()
        data class Deleted(val id: String) : Ev()
        /** A chat message, or an event shown like one ([kind]: chat, cheer, sub, gift, raid). */
        data class Msg(
            val id: String, val authorId: String, val author: String, val text: String, val kind: String,
            val owner: Boolean, val mod: Boolean, val member: Boolean, val amount: String?,
        ) : Ev()
    }

    fun hello(channel: String, anonNumber: Int): String =
        "CAP REQ :twitch.tv/tags twitch.tv/commands\r\nPASS SCHMOOPIIE\r\nNICK justinfan$anonNumber\r\nJOIN #${channel.lowercase()}\r\n"

    fun parse(raw: String): Line? {
        var s = raw.trimEnd('\r', '\n')
        if (s.isEmpty()) return null
        var tags = emptyMap<String, String>()
        if (s.startsWith("@")) {
            val sp = s.indexOf(' ').takeIf { it > 0 } ?: return null
            tags = s.substring(1, sp).split(';').associate { kv ->
                val eq = kv.indexOf('=')
                if (eq < 0) kv to "" else kv.substring(0, eq) to unescape(kv.substring(eq + 1))
            }
            s = s.substring(sp + 1)
        }
        var prefix = ""
        if (s.startsWith(":")) {
            val sp = s.indexOf(' ').takeIf { it > 0 } ?: return null
            prefix = s.substring(1, sp)
            s = s.substring(sp + 1)
        }
        val ti = s.indexOf(" :")
        val trailing = if (ti >= 0) s.substring(ti + 2) else null
        val head = (if (ti >= 0) s.substring(0, ti) else s).split(' ').filter { it.isNotEmpty() }
        if (head.isEmpty()) return null
        return Line(tags, prefix, head[0].uppercase(), head.drop(1), trailing)
    }

    fun event(l: Line): Ev? {
        val t = l.tags
        val badges = t["badges"] ?: ""
        val owner = badges.contains("broadcaster/")
        val mod = t["mod"] == "1" || badges.contains("moderator/")
        val member = t["subscriber"] == "1" || badges.contains("subscriber/")
        val name = t["display-name"]?.ifBlank { null } ?: l.nick
        return when (l.command) {
            "PING" -> Ev.Ping(l.trailing ?: l.params.firstOrNull() ?: "tmi.twitch.tv")
            "RECONNECT" -> Ev.Reconnect
            "ROOMSTATE", "366" -> Ev.Joined
            "NOTICE" -> Ev.Notice(t["msg-id"] ?: "", l.trailing ?: "")
            "CLEARMSG" -> t["target-msg-id"]?.let { Ev.Deleted(it) }
            "PRIVMSG" -> {
                var text = l.trailing ?: ""
                if (text.startsWith("\u0001ACTION ") && text.endsWith("\u0001")) text = text.substring(8, text.length - 1)
                val bits = t["bits"]?.toIntOrNull() ?: 0
                Ev.Msg(t["id"] ?: "", t["user-id"] ?: l.nick, name, text, if (bits > 0) "cheer" else "chat",
                    owner, mod, member, if (bits > 0) "$bits bits" else null)
            }
            "USERNOTICE" -> {
                val text = l.trailing ?: ""
                when (t["msg-id"]) {
                    "sub", "resub" -> Ev.Msg(t["id"] ?: "", t["user-id"] ?: "", name, text, "sub", owner, mod, true,
                        plan(t["msg-param-sub-plan"]))
                    "subgift" -> Ev.Msg(t["id"] ?: "", t["user-id"] ?: "", name, t["msg-param-recipient-display-name"] ?: "", "gift",
                        owner, mod, member, "1")
                    "submysterygift" -> Ev.Msg(t["id"] ?: "", t["user-id"] ?: "", name, "", "gift", owner, mod, member,
                        t["msg-param-mass-gift-count"] ?: "1")
                    "raid" -> Ev.Msg(t["id"] ?: "", t["user-id"] ?: "", t["msg-param-displayName"] ?: name, "", "raid",
                        false, false, false, t["msg-param-viewerCount"] ?: "")
                    "announcement" -> Ev.Msg(t["id"] ?: "", t["user-id"] ?: "", name, text, "chat", owner, mod, member, null)
                    else -> null
                }
            }
            else -> null
        }
    }

    private fun plan(p: String?) = when (p) { "Prime" -> "Prime"; "2000" -> "Tier 2"; "3000" -> "Tier 3"; null, "" -> null; else -> "Tier 1" }

    /** IRCv3 tag values: «\s» space, «\:» semicolon, «\\» backslash, «\r» «\n». */
    fun unescape(v: String): String {
        if (!v.contains('\\')) return v
        val b = StringBuilder(v.length)
        var i = 0
        while (i < v.length) {
            val c = v[i]
            if (c == '\\' && i + 1 < v.length) {
                when (v[i + 1]) { 's' -> b.append(' '); ':' -> b.append(';'); '\\' -> b.append('\\'); 'r' -> b.append('\r'); 'n' -> b.append('\n'); else -> b.append(v[i + 1]) }
                i += 2
            } else { if (c != '\\') b.append(c); i++ }
        }
        return b.toString()
    }
}
