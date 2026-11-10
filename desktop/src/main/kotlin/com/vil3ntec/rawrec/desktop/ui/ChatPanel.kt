package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vil3ntec.rawrec.desktop.studio.*
import kotlinx.coroutines.launch

private val languages = listOf("fa" to "فارسی", "en" to "English", "ar" to "العربية", "tr" to "Türkçe", "ru" to "Русский", "es" to "Español", "de" to "Deutsch")

/** The chats to read, translation, and the chat itself — newest always in view (scrolled for you, unless you scroll up to read). */
@Composable
fun ChatPanel(app: StudioApp) {
    val s = app.settings
    var yt by remember { mutableStateOf(s.youtubeChannel) }
    var tw by remember { mutableStateOf(s.twitchChannel) }
    var kk by remember { mutableStateOf(s.kickChannel) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(300); tick++ } }
    val on = app.chats.isNotEmpty()
    Section("کانال‌ها") {
        T("کانال یا لینکِ پخش. یوتیوب بی‌سهمیه خوانده می‌شود (نه از راهِ API گوگل): محدودیتِ روزانه ندارد.", 11, K.Faint)
        Spacer(Modifier.height(6.dp))
        ChannelRow("YouTube", Color(Platform.YOUTUBE.color), yt, "@کانال یا لینکِ پخش") { yt = it }
        ChannelRow("Twitch", Color(Platform.TWITCH.color), tw, "نامِ کانال") { tw = it }
        ChannelRow("Kick", Color(Platform.KICK.color), kk, "نامِ کانال") { kk = it }
        Spacer(Modifier.height(6.dp))
        Btn(if (on) "قطعِ چت‌ها" else "وصل شدن به چت‌ها", {
            if (on) app.disconnectChats()
            else { app.update { it.copy(youtubeChannel = yt.trim(), twitchChannel = tw.trim(), kickChannel = kk.trim()) }; app.connectChats() }
        }, Modifier.fillMaxWidth(), on = on, height = 32.dp, bold = true)
        for (c in app.chats) Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(if (c.connected) K.Good else K.Warn))
            Spacer(Modifier.width(6.dp))
            T("${c.platform.label}: ${c.status} • ${c.received} پیام", 11, K.Dim, maxLines = 2)
        }
    }
    HLine()
    Section("ترجمه") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T("پیام‌ها به زبانِ من", 12, modifier = Modifier.weight(1f))
            Seg(listOf(true to "روشن", false to "خاموش"), s.translate, { v -> app.update { it.copy(translate = v) } }, Modifier.width(130.dp))
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((code, name) in languages.take(4)) Btn(name, { app.update { it.copy(translateTo = code) } }, Modifier.weight(1f), on = s.translateTo == code, height = 26.dp)
        }
        T("نامِ نویسنده هیچ‌وقت ترجمه نمی‌شود؛ فارسی خودمانی نوشته می‌شود، نه رسمی.", 11, K.Faint, modifier = Modifier.padding(top = 4.dp))
        Translator.lastError?.let { T("ترجمه: $it (چند دقیقه بعد دوباره)", 11, K.Warn) }
    }
    HLine()
    Section("چت") {
        val list = remember(tick, ChatHub.version) { ChatHub.newest(200) }
        val state = rememberLazyListState()
        val scope = rememberCoroutineScope()
        // stay on the newest while the owner is at the bottom; leave them alone while they read older ones
        val atBottom = !state.canScrollForward || state.layoutInfo.totalItemsCount == 0
        LaunchedEffect(list.size, list.lastOrNull()?.id) { if (atBottom && list.isNotEmpty()) state.scrollToItem(list.size - 1) }
        LazyColumn(Modifier.fillMaxWidth().height(360.dp).clip(RoundedCornerShape(6.dp)).background(K.Bg).border(1.dp, K.Line, RoundedCornerShape(6.dp)).padding(6.dp),
            state = state, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(list, key = { it.platform.name + it.id }) { m ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(5.dp)).background(if (m.paid) Color(0x33F59E0B) else Color.Transparent).padding(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(Color(m.platform.color)))
                        Spacer(Modifier.width(5.dp))
                        T(m.author, 12, Color(m.authorColor ?: m.platform.color), bold = true, maxLines = 1)
                        m.amount?.let { T("  $it", 12, K.Amber, bold = true) }
                    }
                    T(m.translated ?: m.text, 13)
                    if (m.translated != null) T(m.text, 11, K.Faint)
                }
            }
        }
        if (!atBottom) Btn("↓ تازه‌ترین پیام‌ها", { scope.launch { if (list.isNotEmpty()) state.scrollToItem(list.size - 1) } }, Modifier.fillMaxWidth().padding(top = 4.dp), height = 24.dp)
    }
}

@Composable
private fun ChannelRow(name: String, color: Color, value: String, hint: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Spacer(Modifier.width(6.dp))
        T(name, 12, K.Dim, modifier = Modifier.width(56.dp))
        Field(value, onChange, Modifier.weight(1f), hint = hint, ltr = true)
    }
}
