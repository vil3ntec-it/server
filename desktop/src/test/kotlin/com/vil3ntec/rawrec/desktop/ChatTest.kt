package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatTest {
    @Test fun twitchMessagesCheersAndGifts() {
        val m = TwitchChat.parse("@badge-info=;color=#1E90FF;display-name=Gamer_Ali;id=abc-1;tmi-sent-ts=1 :gamer_ali!gamer_ali@gamer_ali.tmi.twitch.tv PRIVMSG #chan :nice clutch 😂 @Streamer")!!
        assertEquals("Gamer_Ali", m.author); assertEquals("nice clutch 😂 @Streamer", m.text); assertEquals(ChatMessage.Kind.MESSAGE, m.kind)
        assertEquals(0xFF1E90FF.toInt(), m.authorColor)
        val b = TwitchChat.parse("@bits=100;color=;display-name=Rich;id=b2 :rich!rich@rich.tmi.twitch.tv PRIVMSG #chan :Cheer100 GG")!!
        assertEquals(ChatMessage.Kind.BITS, b.kind); assertEquals("100 bits", b.amount)
        val g = TwitchChat.parse("@display-name=Santa;id=g3;msg-id=subgift;system-msg=Santa\\sgifted\\sa\\sTier\\s1\\ssub\\sto\\sBob! :tmi.twitch.tv USERNOTICE #chan")!!
        assertEquals(ChatMessage.Kind.GIFT, g.kind); assertEquals("Santa gifted a Tier 1 sub to Bob!", g.text)
        assertNull(TwitchChat.parse(":tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!"))
    }

    @Test fun youtubeMessagesEmojiSuperChatsAndNextPage() {
        val o = JSONObject("""{"continuationContents":{"liveChatContinuation":{"continuations":[{"invalidationContinuationData":{"continuation":"NEXT","timeoutMs":4321}}],
          "actions":[
           {"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"id":"m1","authorName":{"simpleText":"علی گیمر"},
              "message":{"runs":[{"text":"lol "},{"emoji":{"emojiId":"😂","shortcuts":[":joy:"]}},{"text":" "},{"emoji":{"emojiId":"UCxyz/abc","shortcuts":[":hand-pink-waving:"],"isCustomEmoji":true}}]}}}}},
           {"addChatItemAction":{"item":{"liveChatPaidMessageRenderer":{"id":"m2","authorName":{"simpleText":"Big Fan"},"purchaseAmountText":{"simpleText":"${'$'}5.00"},
              "message":{"runs":[{"text":"keep going!"}]}}}}},
           {"addChatItemAction":{"item":{"liveChatMembershipItemRenderer":{"id":"m3","authorName":{"simpleText":"New One"},"headerSubtext":{"runs":[{"text":"Welcome to "},{"text":"Members"}]}}}}},
           {"addChatItemAction":{"item":{"liveChatViewerEngagementMessageRenderer":{"id":"x"}}}},
           {"markChatItemAsDeletedAction":{}}]}}}""")
        val (msgs, next, wait) = YouTubeChat.parse(o)
        assertEquals(3, msgs.size)
        assertEquals("علی گیمر", msgs[0].author)
        assertEquals("lol 😂 :hand-pink-waving:", msgs[0].text)
        assertEquals(ChatMessage.Kind.SUPERCHAT, msgs[1].kind); assertEquals("${'$'}5.00", msgs[1].amount); assertEquals("keep going!", msgs[1].text)
        assertEquals(ChatMessage.Kind.MEMBER, msgs[2].kind)
        assertEquals("NEXT", next); assertEquals(4321L, wait)
    }

    @Test fun youtubeStartsFromLiveChatNotTopChat() {
        val page = """<script>var ytInitialData = {"contents":{"liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"TOP"}}],
          "header":{"liveChatHeaderRenderer":{"viewSelector":{"sortFilterSubMenuRenderer":{"subMenuItems":[
             {"title":"Top chat","continuation":{"reloadContinuationData":{"continuation":"TOP"}}},
             {"title":"Live chat","continuation":{"reloadContinuationData":{"continuation":"ALL"}}}]}}}}}}};</script>"""
        assertEquals("ALL", YouTubeChat.allChatContinuation(YouTubeChat.initialData(page)!!))
        val noMenu = """window["ytInitialData"] = {"contents":{"liveChatRenderer":{"continuations":[{"invalidationContinuationData":{"continuation":"ONLY"}}]}}};"""
        assertEquals("ONLY", YouTubeChat.allChatContinuation(YouTubeChat.initialData(noMenu)!!))
    }

    @Test fun youtubeWhatTheOwnerTypes() {
        assertEquals("dQw4w9WgXcQ", YouTubeChat.videoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"))
        assertEquals("dQw4w9WgXcQ", YouTubeChat.videoId("https://youtu.be/dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", YouTubeChat.videoId("https://www.youtube.com/live/dQw4w9WgXcQ?si=x"))
        assertNull(YouTubeChat.videoId("@LofiGirl"))
        assertEquals("https://www.youtube.com/@LofiGirl/live", YouTubeChat.watchUrl("@LofiGirl"))
        assertEquals("https://www.youtube.com/@LofiGirl/live", YouTubeChat.watchUrl("https://www.youtube.com/@LofiGirl/streams"))
        assertEquals("https://www.youtube.com/@mychannel/live", YouTubeChat.watchUrl("mychannel"))
        assertEquals("https://www.youtube.com/channel/UC123/live", YouTubeChat.watchUrl("youtube.com/channel/UC123"))
        val live = """<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"> ... "isLive":true"""
        assertEquals("abcdefghijk", YouTubeChat.liveVideoOf(live))
        assertNull(YouTubeChat.liveVideoOf("""<link rel="canonical" href="https://www.youtube.com/@x">"""))
        // a page that hides its address but still has the live video in its data
        assertEquals("zyxwvutsrqp", YouTubeChat.liveVideoOf(""""currentVideoEndpoint":{"clickTrackingParams":"x","watchEndpoint":{"videoId":"zyxwvutsrqp"}} "isLive":true"""))
    }

    @Test fun kickMessagesKeepEmoteNames() {
        val f = """{"event":"App\\Events\\ChatMessageEvent","data":"{\"id\":\"k1\",\"content\":\"gg [emote:37226:KEKW] wp\",\"sender\":{\"username\":\"kicker\",\"identity\":{\"color\":\"#FF0000\"}}}","channel":"chatrooms.1.v2"}"""
        val m = KickChat.parse(f)!!
        assertEquals("kicker", m.author); assertEquals("gg :KEKW: wp", m.text); assertEquals(0xFFFF0000.toInt(), m.authorColor)
        assertNull(KickChat.parse("""{"event":"pusher:connection_established","data":"{}"}"""))
    }

    @Test fun translationIsCasualPersianAndSameLanguageIsLeftAlone() {
        Translator.transport = { url ->
            if (url.contains("tl=fa") && url.contains("I+want")) """[[["من می‌خواهم آن را ببینم","I want to see that",null,null,10]],null,"en"]"""
            else if (url.contains("tl=fa")) """[[["سلام","سلام",null,null,10]],null,"fa"]""" else null
        }
        try {
            val r = Translator.text("I want to see that", "fa")!!
            println("casual: $r")
            assertTrue(r != "من می‌خواهم آن را ببینم", "still written Persian: $r")      // made spoken, not formal
            assertTrue(!r.contains("می‌خواهم"), r)
            assertNull(Translator.text("سلام", "fa"))
        } finally { Translator.transport = null }
    }

    @Test fun theSameMessageTwiceIsShownOnce() {
        ChatHub.clear()
        val m = ChatMessage("same", Platform.TWITCH, "a", "hi")
        ChatHub.add(m); ChatHub.add(m)
        assertEquals(1, ChatHub.newest(10).size)
        ChatHub.add(m.copy(kind = ChatMessage.Kind.SUPERCHAT, id = "p", amount = "${'$'}2"))
        assertNotNull(ChatHub.alerts.peekFirst())
        ChatHub.clear()
    }

    @Test fun persianIsSpokenNotWritten() {
        assertEquals("چه بازی خوبیه، فردا همه شما رو می‌بینم!", Translator.spoken("چه بازی خوبی است، فردا همه شما رو می‌بینم!"))
        assertEquals("این خوبه", Translator.spoken("این خوب است"))
        assertEquals("خیلی خسته‌ست.", Translator.spoken("خیلی خسته است."))
        assertEquals("همین‌جاست", Translator.spoken("همین‌جا است"))
        assertEquals("او هست", Translator.spoken("او هست"))            // «هست» stays
        assertEquals("استاد خوب", Translator.spoken("استاد خوب"))     // «است» inside a word stays
    }
}
