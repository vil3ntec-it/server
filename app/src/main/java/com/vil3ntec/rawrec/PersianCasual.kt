package com.vil3ntec.rawrec

/**
 * 7.7: what the owner types in chat is spoken Persian («میخام»، «اون مپ رو دوست دارم»، «برو استارت کن»),
 * and translators are taught on written Persian: they guessed — «I like that game» for «اون مپ رو
 * دوست دارم», or a word changed into another. Before translating, the spoken forms become the written
 * ones (only forms with one meaning), and the gamers' words written in Persian letters («مپ»، «استارت»،
 * «لول») go back to the English they came from, so they are kept, not «translated». What the owner sees
 * in the chat is always what they wrote; only what is sent to the translator changes.
 */
object PersianCasual {

    private val WORDS: Map<String, String> = linkedMapOf(
        // wanting, knowing, being able
        "میخام" to "می‌خواهم", "میخوام" to "می‌خواهم", "میخوای" to "می‌خواهی", "میخای" to "می‌خواهی",
        "میخواد" to "می‌خواهد", "میخاد" to "می‌خواهد", "میخوایم" to "می‌خواهیم", "میخایم" to "می‌خواهیم",
        "میخواین" to "می‌خواهید", "میخاین" to "می‌خواهید", "میخوان" to "می‌خواهند", "میخان" to "می‌خواهند",
        "نمیخام" to "نمی‌خواهم", "نمیخوام" to "نمی‌خواهم", "نمیخوای" to "نمی‌خواهی", "نمیخواد" to "نمی‌خواهد", "نمیخاد" to "نمی‌خواهد",
        "میدونم" to "می‌دانم", "میدونی" to "می‌دانی", "میدونه" to "می‌داند", "میدونیم" to "می‌دانیم", "میدونین" to "می‌دانید",
        "نمیدونم" to "نمی‌دانم", "نمیدونی" to "نمی‌دانی", "نمیدونه" to "نمی‌داند",
        "میتونم" to "می‌توانم", "میتونی" to "می‌توانی", "میتونه" to "می‌تواند", "میتونیم" to "می‌توانیم", "میتونین" to "می‌توانید",
        "نمیتونم" to "نمی‌توانم", "نمیتونی" to "نمی‌توانی", "نمیتونه" to "نمی‌تواند",
        // going, coming, saying, doing, becoming, having
        "میرم" to "می‌روم", "میری" to "می‌روی", "میره" to "می‌رود", "میریم" to "می‌رویم", "میرین" to "می‌روید",
        "بریم" to "برویم", "برم" to "بروم",
        "میام" to "می‌آیم", "میای" to "می‌آیی", "میاد" to "می‌آید", "میایم" to "می‌آییم", "نمیام" to "نمی‌آیم", "نمیاد" to "نمی‌آید", "بیاین" to "بیایید",
        "میگم" to "می‌گویم", "میگی" to "می‌گویی", "میگه" to "می‌گوید", "میگیم" to "می‌گوییم", "میگن" to "می‌گویند",
        "میکنم" to "می‌کنم", "میکنی" to "می‌کنی", "میکنه" to "می‌کند", "میکنیم" to "می‌کنیم", "میکنن" to "می‌کنند",
        "نمیکنم" to "نمی‌کنم", "نمیکنه" to "نمی‌کند",
        "میشه" to "می‌شود", "نمیشه" to "نمی‌شود", "میشم" to "می‌شوم", "میشی" to "می‌شوی",
        "داره" to "دارد", "نداره" to "ندارد", "دارن" to "دارند",
        "چیه" to "چیست", "کیه" to "کیست", "خوبه" to "خوب است", "کجایی" to "کجا هستی",
        // that, this, one, for, if …
        "اون" to "آن", "اونجا" to "آنجا", "اونا" to "آن‌ها", "اینا" to "این‌ها", "یه" to "یک", "رو" to "را",
        "واسه" to "برای", "واسم" to "برایم", "واست" to "برایت", "مگه" to "مگر", "اگه" to "اگر", "دیگه" to "دیگر",
        "همش" to "همه‌اش", "یکم" to "یک کم", "منم" to "من هم", "توام" to "تو هم", "اونم" to "او هم", "هنوزم" to "هنوز هم",
        "اینجوری" to "این‌طوری", "اونجوری" to "آن‌طوری", "چجوری" to "چطور",
        "بهش" to "به او", "ازش" to "از او", "باهاش" to "با او", "بهت" to "به تو", "ازت" to "از تو", "باهات" to "با تو",
        "بهم" to "به من", "ازم" to "از من", "باهام" to "با من",
        // gamers' words written in Persian letters: back to the English they are
        "مپ" to "map", "گیم" to "game", "گیمر" to "gamer", "استارت" to "start", "پلیر" to "player", "پلیرا" to "players",
        "لول" to "level", "اسکین" to "skin", "کیل" to "kill", "دمیج" to "damage", "لگ" to "lag", "پینگ" to "ping",
        "لابی" to "lobby", "رنک" to "rank", "استریم" to "stream", "سابسکرایب" to "subscribe", "کلن" to "clan",
        "اسکواد" to "squad", "سولو" to "solo", "اسنایپر" to "sniper", "هدشات" to "headshot", "ریسپان" to "respawn",
        "آپدیت" to "update", "سیزن" to "season", "ایونت" to "event", "مچ" to "match", "راند" to "round",
        "چیتر" to "cheater", "نوب" to "noob",
    )

    /** One word, not part of a longer one (Persian letters and the half-space count as part of a word). */
    private val WORD = Regex("[\\p{L}\\u200c]+")

    /**
     * The other way, for viewers' messages put into Persian: translators answer in written, formal
     * Persian («می‌خواهم آن را ببینم»); the owner reads chat as it is spoken («میخام اونو ببینم»).
     * Only the forms above, each back to its first spoken spelling; gamers' words are not touched.
     */
    private val BACK: Map<String, String> by lazy {
        WORDS.entries.filter { e -> e.value.none { it in 'a'..'z' } && ' ' !in e.value }
            .groupBy { it.value }.mapValues { it.value.first().key }
    }

    /** «می خواهم» with a space (as Google writes it) is the same word as «می‌خواهم». */
    private val MI = Regex("(?<![\\p{L}\\u200c])(ن?می) (?=\\p{L})")

    fun casual(fa: String): String = WORD.replace(MI.replace(fa, "$1\u200c")) { m -> BACK[m.value] ?: m.value }

    fun normalize(text: String): String {
        // the same letters, whichever keyboard typed them
        val t = text.replace('ي', 'ی').replace('ك', 'ک')
        return WORD.replace(t) { m -> WORDS[m.value] ?: m.value }
    }
}
