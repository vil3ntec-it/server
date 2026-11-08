package com.vil3ntec.rawrec

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The chat translator asks Google first (everyday Persian comes out right), the phone's own only without it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TranslatorTest {
    private val app: Context get() = RuntimeEnvironment.getApplication()
    private val asked = ArrayList<String>()

    @After fun reset() { ChatTranslator.transport = null }

    private fun wait(block: ((String?) -> Unit) -> Unit): String? {
        var got: String? = null
        val l = CountDownLatch(1)
        block { got = it; l.countDown() }
        assertTrue("answered", l.await(10, TimeUnit.SECONDS))
        return got
    }

    @Test fun friendlyPersianBothWays() {
        ChatTranslator.transport = { url ->
            asked += url
            when {
                url.contains("tl=fa") && url.contains("q=hey+bro") -> """[[["سلام داداش، چطوری؟","hey bro how are you",null,null,10]],null,"en"]"""
                url.contains("tl=fa") -> """[[["همین","همین",null,null,10]],null,"fa"]"""
                else -> """[[["Hey bro, I wanna ","داداش میخام ",null,null,10],["play together tonight","امشب با هم بازی کنیم",null,null,10]],null,"fa"]"""
            }
        }
        LiveExtras.setTrTarget(app, "en")
        assertEquals("سلام داداش، چطوری؟", wait { ChatTranslator.toPersian(app, "hey bro how are you", it) })
        assertNull("Persian stays as written", wait { ChatTranslator.toPersian(app, "داداش گل", it) })
        assertEquals("every part of the sentence", "Hey bro, I wanna play together tonight", wait { ChatTranslator.fromPersian(app, "داداش میخام امشب با هم بازی کنیم", it) })
        assertTrue("from Persian into the chosen language", asked.last().contains("sl=fa") && asked.last().contains("tl=en"))
    }
}
