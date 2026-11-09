package com.vil3ntec.rawrec

import org.junit.Assert.assertEquals
import org.junit.Test

/** 7.7: the owner's spoken Persian for the translator, viewers' messages back in spoken Persian, YouTube's emoji. */
class CasualChatTest {

    @Test fun spokenPersianBecomesWrittenAndGamersWordsStayEnglish() {
        assertEquals("آن map را دوست دارم", PersianCasual.normalize("اون مپ رو دوست دارم"))
        assertEquals("بازی zero dum برو start کن", PersianCasual.normalize("بازی zero dum برو استارت کن"))
        assertEquals("نمی‌دانم چرا lag دارد", PersianCasual.normalize("نمیدونم چرا لگ داره"))
        // a word only inside a longer one is left alone; names in Latin letters too
        assertEquals("مپینگ Elden Ring", PersianCasual.normalize("مپینگ Elden Ring"))
        // the Arabic keyboard's letters are the same word
        assertEquals("می‌خواهم", PersianCasual.normalize("ميخام"))
    }

    @Test fun formalPersianReadsAsSpoken() {
        assertEquals("من میخام اون نقشه رو ببینم", PersianCasual.casual("من می خواهم آن نقشه را ببینم"))
        assertEquals("من نمیدونم چه خبر است", PersianCasual.casual("من نمی دانم چه خبر است"))
        assertEquals("map stays map", PersianCasual.casual("map stays map"))
        assertEquals("هی داداش چطوری؟", PersianCasual.casual("هی داداش چطوری؟"))
    }

    @Test fun youTubeEmojiBecomeThePhonesEmoji() {
        assertEquals("hi 👋😊", YtEmoji.toUnicode("hi :hand-pink-waving::face-blue-smiling:"))
        assertEquals("❤️", YtEmoji.toUnicode(":red-heart:"))
        assertEquals("a time stays a time: 12:30:45", YtEmoji.toUnicode("a time stays a time: 12:30:45"))
        assertEquals("unknown one", YtEmoji.toUnicode(":unknown-one:"))
        assertEquals("phone emoji 😂 untouched", YtEmoji.toUnicode("phone emoji 😂 untouched"))
    }
}
