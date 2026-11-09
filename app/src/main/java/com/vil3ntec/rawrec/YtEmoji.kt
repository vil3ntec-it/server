package com.vil3ntec.rawrec

/**
 * 7.7: YouTube's own emoji come through its chat API as words between colons («:face-blue-smiling:»,
 * «:hand-pink-waving:», a channel's «:_name:»), which the owner saw as text instead of an emoji.
 * Each becomes the phone's nearest emoji, read from the words in its name; one whose meaning is not
 * known stays as its name without the colons. The phone's own emoji (Unicode) pass through untouched.
 */
object YtEmoji {
    private val CODE = Regex(":([A-Za-z0-9_][A-Za-z0-9_+\\-]{1,48}):")

    /** Words in the name → the emoji (the first that matches wins: the more particular ones first). */
    private val WORDS = listOf(
        listOf("heart-eyes", "heart-shape", "hearts") to "😍",
        listOf("heart") to "❤️",
        listOf("waving", "wave", "hello", "hi") to "👋",
        listOf("laughing", "laugh", "lol", "rofl", "tears-of-joy") to "😂",
        listOf("crying", "cry", "sad", "tear") to "😢",
        listOf("wide-eyes", "shocked", "surprised", "wow") to "😳",
        listOf("frowning", "frown", "upset") to "☹️",
        listOf("angry", "mad", "rage") to "😠",
        listOf("smiling", "smile", "happy", "grin") to "😊",
        listOf("thumbs-up", "thumbsup", "like") to "👍",
        listOf("thumbs-down", "dislike") to "👎",
        listOf("clap", "clapping") to "👏",
        listOf("fire", "lit") to "🔥",
        listOf("100") to "💯",
        listOf("party", "celebrate", "confetti") to "🥳",
        listOf("cool", "sunglasses") to "😎",
        listOf("thinking", "think", "question") to "🤔",
        listOf("eyes", "looking") to "👀",
        listOf("skull", "dead") to "💀",
        listOf("money", "dollar") to "💰",
        listOf("crown", "king") to "👑",
        listOf("star") to "⭐",
        listOf("trophy", "win", "winner") to "🏆",
        listOf("gg", "game-over") to "🎮",
        listOf("buffering", "loading") to "⏳",
        listOf("ok", "okay") to "👌",
        listOf("pray", "please") to "🙏",
        listOf("hug") to "🤗",
        listOf("kiss") to "😘",
        listOf("sleep", "sleepy", "zzz") to "😴",
        listOf("rocket") to "🚀",
        listOf("gift") to "🎁",
    )

    fun toUnicode(text: String): String {
        if (':' !in text) return text
        return CODE.replace(text) { m ->
            val name = m.groupValues[1].lowercase()
            // a time («12:30:45») or anything without letters is not an emoji
            if (name.none { it in 'a'..'z' }) return@replace m.value
            val parts = name.split('-', '_').filter { it.isNotEmpty() }
            val hit = WORDS.firstOrNull { (keys, _) -> keys.any { k -> if ('-' in k) name.contains(k) else k in parts } }
            hit?.second ?: name.trim('_').replace('-', ' ').replace('_', ' ')
        }
    }
}
