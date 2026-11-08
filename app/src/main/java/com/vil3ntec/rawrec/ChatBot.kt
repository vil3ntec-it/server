package com.vil3ntec.rawrec

import kotlin.random.Random

/**
 * The chat bot of the live stream: commands, timed messages, welcome, giveaway and automod.
 * Plain logic with no Android or network inside (tested on the JVM): messages go in, actions come
 * out, and [LiveChat] carries them out. Every message the bot sends costs YouTube quota (20 units),
 * so it is frugal by design: a command answers at most once per 15 s, welcomes are gathered into one
 * message, timers only run while people are chatting, warnings at most one per 30 s.
 */
class ChatBot(
    @Volatile var cfg: Config,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val rnd: Random = Random.Default,
) {
    /** What the owner set. [commands]: «!name» → reply; [timers]: minutes → message. */
    data class Config(
        val on: Boolean = false,
        val commands: Map<String, String> = emptyMap(),
        val timers: List<Pair<Int, String>> = emptyList(),
        val welcome: Boolean = false,
        val welcomeText: String = "",
        val modLinks: Boolean = true,
        val modCaps: Boolean = false,
        val modSpam: Boolean = true,
        val words: List<String> = emptyList(),
        val joinWord: String = "!join",
        val texts: Texts = Texts(),
    )

    /** Built-in replies, from the app's strings (so this class stays plain). {user} {viewers} … are filled in. */
    data class Texts(
        val uptime: String = "{uptime}",
        val viewers: String = "{viewers}",
        val subs: String = "{subs}",
        val goal: String = "{goal}",
        val commands: String = "{list}",
        val warnLink: String = "@{user} no links",
        val warnCaps: String = "@{user} no caps",
        val warnSpam: String = "@{user} no spam",
        val warnWord: String = "@{user} mind your words",
        val giveawayOpen: String = "giveaway: {word}",
        val giveawayWinner: String = "winner: {user}",
        val giveawayNone: String = "no entries",
        val and: String = ", ",
    )

    /** A chat message as the bot sees it. [canReply]: the platform takes messages from us (YouTube). */
    class In(
        val id: String, val authorId: String, val author: String, val text: String,
        val owner: Boolean = false, val mod: Boolean = false, val member: Boolean = false,
        val canReply: Boolean = true, val canModerate: Boolean = true,
    )

    /** The stream's numbers for {viewers} {subs} {likes} {uptime} {goal}. */
    class Vars(val viewers: Long = 0, val subs: Long = 0, val likes: Long = 0, val uptimeS: Long = 0, val goal: String = "")

    sealed class Out {
        data class Send(val text: String) : Out()
        data class Delete(val id: String) : Out()
        data class Timeout(val authorId: String, val author: String, val seconds: Int) : Out()
        /** The giveaway has a winner (shown on the stream as well). */
        data class Winner(val name: String, val entries: Int) : Out()
    }

    enum class Rule { LINK, CAPS, SPAM, WORD }

    // ---- state of this stream
    private val seen = HashSet<String>()
    private val welcomeQueue = ArrayList<String>()
    private var welcomeSince = 0L
    private val lastCmd = HashMap<String, Long>()
    private val timerAt = HashMap<Int, Long>()
    private var chatSinceTimer = 0
    private var lastWarn = 0L
    private val strikes = HashMap<String, Int>()
    private val recent = HashMap<String, ArrayDeque<Pair<Long, String>>>()
    private var started = 0L
    /** What the bot said lately: it comes back through the chat as the owner's message and is not a command. */
    private val said = ArrayDeque<Pair<Long, String>>()

    /** Giveaway: open while [giveawayWord] is non-null. */
    @Volatile var giveawayWord: String? = null; private set
    private val entrants = LinkedHashMap<String, String>()   // authorId → name
    val entries: Int get() = synchronized(this) { entrants.size }
    var automodActions = 0; private set
    var sent = 0; private set

    @Synchronized
    fun onMessage(m: In, v: Vars): List<Out> {
        if (started == 0L) started = clock()
        val out = ArrayList<Out>()
        val c = cfg
        val now = clock()
        val text = m.text.trim()
        val privileged = m.owner || m.mod
        while (said.isNotEmpty() && now - said.first().first > 120_000) said.removeFirst()
        if (m.owner && said.any { it.second == text }) return out

        // Giveaway entries are counted even with the bot off (the owner opened it from the panel).
        giveawayWord?.let { w -> if (!m.owner && norm(text) == norm(w)) entrants.putIfAbsent(m.authorId, m.author) }
        if (m.owner && text.startsWith("!giveaway", ignoreCase = true)) return ownerGiveaway(text, out)
        if (!c.on) return out

        // ---- automod first: a removed message gets no reply and no welcome.
        if (!privileged && m.canModerate) {
            val broke = rule(m, c, now)
            if (broke != null) {
                automodActions++
                out += Out.Delete(m.id)
                val n = (strikes[m.authorId] ?: 0) + 1
                strikes[m.authorId] = n
                when {
                    n == 2 -> out += Out.Timeout(m.authorId, m.author, 60)
                    n >= 3 -> out += Out.Timeout(m.authorId, m.author, 300)
                }
                if (m.canReply && now - lastWarn >= 30_000) {
                    lastWarn = now
                    val t = when (broke) { Rule.LINK -> c.texts.warnLink; Rule.CAPS -> c.texts.warnCaps; Rule.SPAM -> c.texts.warnSpam; Rule.WORD -> c.texts.warnWord }
                    send(out, fill(t, m.author, v))
                }
                return out
            }
        }
        chatSinceTimer++

        // ---- welcome: first message of someone in this stream (gathered, sent by [tick])
        if (c.welcome && !m.owner && m.canReply && seen.add(m.authorId)) {
            if (welcomeQueue.isEmpty()) welcomeSince = now
            if (welcomeQueue.size < 12) welcomeQueue += m.author
        } else seen.add(m.authorId)

        // ---- commands
        if (text.startsWith("!") && m.canReply) {
            val name = text.substringBefore(' ').lowercase()
            val reply = c.commands[name] ?: builtIn(name, c)
            if (reply != null && now - (lastCmd[name] ?: 0L) >= 15_000) {
                lastCmd[name] = now
                send(out, fill(reply, m.author, v))
            }
        }
        return out
    }

    /** Someone who wrote before the bot started (old messages of the chat): not welcomed again. */
    @Synchronized
    fun markSeen(authorId: String) { seen.add(authorId) }

    /** Every few seconds: timed messages and the gathered welcome. */
    @Synchronized
    fun tick(v: Vars): List<Out> {
        val out = ArrayList<Out>()
        val c = cfg
        if (!c.on) return out
        val now = clock()
        if (started == 0L) started = now
        if (welcomeQueue.isNotEmpty() && now - welcomeSince >= 20_000) {
            val names = if (welcomeQueue.size > 5) welcomeQueue.take(5).joinToString(c.texts.and) + " +" + (welcomeQueue.size - 5)
            else welcomeQueue.joinToString(c.texts.and)
            welcomeQueue.clear()
            if (c.welcomeText.isNotBlank()) send(out, fill(c.welcomeText, names, v))
        }
        // Timers: when their minutes have passed and at least three people's messages came since.
        if (chatSinceTimer >= 3) for ((i, t) in c.timers.withIndex()) {
            val (min, msg) = t
            if (min <= 0 || msg.isBlank()) continue
            val last = timerAt[i] ?: started
            if (now - last >= min * 60_000L) {
                timerAt[i] = now
                chatSinceTimer = 0
                send(out, fill(msg, "", v))
                break   // one at a time
            }
        }
        return out
    }

    /** Opens the giveaway: whoever writes [word] (once) is in. */
    @Synchronized
    fun startGiveaway(word: String? = null): Out.Send? {
        val w = (word ?: cfg.joinWord).trim().ifBlank { "!join" }
        giveawayWord = w
        entrants.clear()
        return Out.Send(cfg.texts.giveawayOpen.replace("{word}", w)).also { sent++; remember(it.text) }
    }

    /** Draws a winner (and removes them, so a second draw gives someone else). Null when no one entered. */
    @Synchronized
    fun draw(): List<Out> {
        if (entrants.isEmpty()) return listOf(Out.Send(cfg.texts.giveawayNone).also { sent++; remember(it.text) })
        val total = entrants.size
        val pick = entrants.entries.elementAt(rnd.nextInt(total))
        entrants.remove(pick.key)
        sent++
        val msg = cfg.texts.giveawayWinner.replace("{user}", pick.value)
        remember(msg)
        return listOf(Out.Winner(pick.value, total), Out.Send(msg))
    }

    @Synchronized
    fun stopGiveaway() { giveawayWord = null; entrants.clear() }

    // ------------------------------------------------------------ inside

    private fun ownerGiveaway(text: String, out: MutableList<Out>): List<Out> {
        val parts = text.split(Regex("\\s+"))
        when (parts.getOrNull(1)?.lowercase()) {
            "start", "open" -> startGiveaway(parts.getOrNull(2))?.let { out += it }
            "draw", "roll" -> out += draw()
            "stop", "end", "close" -> stopGiveaway()
        }
        return out
    }

    private fun send(out: MutableList<Out>, t: String) {
        val s = t.trim().take(200)
        if (s.isEmpty()) return
        sent++
        remember(s)
        out += Out.Send(s)
    }

    private fun remember(s: String) {
        said.addLast(clock() to s.trim())
        if (said.size > 20) said.removeFirst()
    }

    private fun builtIn(name: String, c: Config): String? = when (name) {
        "!uptime", "!زمان" -> c.texts.uptime
        "!viewers", "!بیننده" -> c.texts.viewers
        "!subs", "!مشترک" -> c.texts.subs
        "!goal", "!هدف" -> c.texts.goal
        "!commands", "!فرمان", "!فرمان‌ها", "!دستورات" ->
            if (c.commands.isEmpty()) null else c.texts.commands.replace("{list}", c.commands.keys.joinToString(" "))
        else -> null
    }

    private fun fill(t: String, user: String, v: Vars): String = t
        .replace("{user}", user)
        .replace("{viewers}", v.viewers.toString())
        .replace("{subs}", v.subs.toString())
        .replace("{likes}", v.likes.toString())
        .replace("{goal}", v.goal)
        .replace("{uptime}", uptime(v.uptimeS))

    private fun rule(m: In, c: Config, now: Long): Rule? {
        val t = m.text
        if (c.modLinks && LINK.containsMatchIn(t)) return Rule.LINK
        if (c.words.isNotEmpty()) {
            val n = norm(t)
            if (c.words.any { it.isNotBlank() && n.contains(norm(it)) }) return Rule.WORD
        }
        if (c.modCaps) {
            val letters = t.count { it.isLetter() && it.isUpperCase() || it.isLetter() && it.isLowerCase() }
            val upper = t.count { it.isLetter() && it.isUpperCase() }
            if (letters >= 12 && upper * 10 >= letters * 7) return Rule.CAPS
        }
        if (c.modSpam) {
            val q = recent.getOrPut(m.authorId) { ArrayDeque() }
            while (q.isNotEmpty() && now - q.first().first > 60_000) q.removeFirst()
            val n = norm(t)
            q.addLast(now to n)
            if (q.size > 12) q.removeFirst()
            val same = q.count { it.second == n }
            val burst = q.count { now - it.first <= 10_000 }
            if (same >= 3 || burst >= 6 || REPEAT.containsMatchIn(t)) return Rule.SPAM
        }
        return null
    }

    companion object {
        private val LINK = Regex(
            "(https?://|www\\.|\\bt\\.me/|\\b[a-z0-9-]{2,}\\s?(\\.|\\(dot\\)|\\[dot\\])\\s?(com|net|org|ir|io|gg|me|tv|xyz|ly|co|info|app|link|site|shop|ru|top|live|store|online)\\b)",
            RegexOption.IGNORE_CASE)
        /** The same character 15 times in a row. */
        private val REPEAT = Regex("(.)\\1{14,}")

        /** For comparing words: lower case, Arabic letter forms as Persian ones, no ZWNJ / tatweel / marks. */
        fun norm(s: String): String {
            val b = StringBuilder(s.length)
            for (ch in s.lowercase()) {
                when (ch) {
                    'ي', 'ى' -> b.append('ی')
                    'ك' -> b.append('ک')
                    'ة' -> b.append('ه')
                    'أ', 'إ', 'آ' -> b.append('ا')
                    '‌', '‍', 'ـ' -> {}
                    in 'ً'..'ٟ', 'ٰ' -> {}
                    else -> b.append(ch)
                }
            }
            return b.toString().trim()
        }

        fun uptime(s: Long): String = if (s >= 3600) String.format(java.util.Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
        else String.format(java.util.Locale.US, "%d:%02d", s / 60, s % 60)

        /** «!name = reply» lines (also «:»); names get their «!» and lower case. */
        fun parseCommands(text: String): Map<String, String> {
            val m = LinkedHashMap<String, String>()
            for (line in text.lines()) {
                val i = line.indexOf('=').takeIf { it > 0 } ?: line.indexOf(':').takeIf { it > 0 } ?: continue
                var name = line.substring(0, i).trim().lowercase()
                val reply = line.substring(i + 1).trim()
                if (name.isEmpty() || reply.isEmpty() || name.contains(' ')) continue
                if (!name.startsWith("!")) name = "!$name"
                m[name] = reply
            }
            return m
        }

        /** «minutes = message» lines. */
        fun parseTimers(text: String): List<Pair<Int, String>> = text.lines().mapNotNull { line ->
            val i = line.indexOf('=').takeIf { it > 0 } ?: return@mapNotNull null
            val min = toAsciiDigits(line.substring(0, i).trim()).toIntOrNull() ?: return@mapNotNull null
            val msg = line.substring(i + 1).trim()
            if (min in 1..600 && msg.isNotEmpty()) min to msg else null
        }

        fun parseWords(text: String): List<String> = text.split(',', '،', '\n').map { it.trim() }.filter { it.isNotEmpty() }

        /** «۱۵» and «١٥» as 15. */
        fun toAsciiDigits(s: String): String = buildString {
            for (ch in s) append(when (ch) { in '۰'..'۹' -> '0' + (ch - '۰'); in '٠'..'٩' -> '0' + (ch - '٠'); else -> ch })
        }
    }
}
