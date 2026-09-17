package ir.vil3ntec.admin.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Ago
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.SUPPORT_SECTIONS
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private data class Thread(
  val id: String,
  val who: String,
  val lastMessage: String,
  val updatedAt: Long,
  val unread: Int,
  val status: String,
)

private data class Message(
  val id: Long,
  val fromAdmin: Boolean,
  val body: String,
  val at: Long,
  val senderName: String,
)

/**
 *  پشتیبانی — سه بخش، چون سه کسب‌وکارِ جدا است و قاطی شدنشان یعنی جوابِ
 *  مشتریِ پمپ به صاحبِ فروشگاه برود.
 */
@Composable
fun SupportScreen(session: Session, onUnread: (Int) -> Unit) {
  var sectionIndex by remember { mutableIntStateOf(0) }
  var openThread by remember { mutableStateOf<Thread?>(null) }

  val section = SUPPORT_SECTIONS[sectionIndex]

  if (openThread != null) {
    BackHandler { openThread = null }
    ChatScreen(session, openThread!!, onBack = { openThread = null })
    return
  }

  Column(Modifier.fillMaxSize()) {
    Text(
      "پشتیبانی",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
      style = MaterialTheme.typography.headlineSmall,
    )

    TabRow(selectedTabIndex = sectionIndex) {
      SUPPORT_SECTIONS.forEachIndexed { index, item ->
        Tab(
          selected = sectionIndex == index,
          onClick = { sectionIndex = index },
          text = { Text(item.title) },
        )
      }
    }

    ThreadList(session, section.app, onUnread = onUnread, onOpen = { openThread = it })
  }
}

@Composable
private fun ThreadList(
  session: Session,
  app: String,
  onUnread: (Int) -> Unit,
  onOpen: (Thread) -> Unit,
) {
  var threads by remember(app) { mutableStateOf<List<Thread>?>(null) }
  var error by remember(app) { mutableStateOf("") }

  LaunchedEffect(app) {
    while (true) {
      try {
        val reply = withContext(Dispatchers.IO) { Api.supportThreads(session, app) }
        val array = reply.items("threads")
        threads = (0 until array.length()).map { index ->
          val row = array.optJSONObject(index) ?: JSONObject()
          Thread(
            id = row.optString("threadId").ifBlank { row.optString("thread_id") },
            who = row.optString("who").ifBlank { row.optString("accountName") },
            lastMessage = row.optString("lastMessage"),
            updatedAt = row.optLong("updatedAt"),
            unread = row.optInt("unreadAdmin"),
            status = row.optString("status"),
          )
        }
        onUnread(reply.o().optInt("unread"))
        error = ""
      } catch (e: Exception) {
        error = e.message ?: "وصل نشد"
      }
      delay(5_000)
    }
  }

  when {
    threads == null && error.isNotBlank() -> ErrorState(error) { }
    threads == null -> Loading()
    threads!!.isEmpty() -> EmptyState(
      "پیامی در این بخش نیست",
      "هر وقت مشتری از این برنامه بنویسد، همین‌جا می‌آید.",
    )
    else -> LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      items(threads!!, key = { it.id }) { thread ->
        Card(Modifier.fillMaxWidth().clickable { onOpen(thread) }) {
          Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Column(Modifier.weight(1f)) {
              Text(thread.who.ifBlank { "بی‌نام" }, style = MaterialTheme.typography.bodyLarge,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
              Text(
                thread.lastMessage.ifBlank { "—" },
                Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
              )
              Text(
                Ago.of(thread.updatedAt),
                Modifier.padding(top = 4.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
            if (thread.unread > 0) Badge { Text(thread.unread.toString()) }
            else if (thread.status == "closed") Chip("بسته", MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
}

/**
 *  خودِ گفت‌وگو.
 *
 *  ⚠️ پیام‌های تازه با `after` گرفته می‌شوند نه با گرفتنِ دوبارهٔ کلِ
 *  گفت‌وگو: روی اینترنتِ ضعیف، هر بار کشیدنِ دویست پیام یعنی چت کُند و
 *  مصرفِ بی‌خودِ داده.
 */
@Composable
private fun ChatScreen(session: Session, thread: Thread, onBack: () -> Unit) {
  var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
  var draft by remember { mutableStateOf("") }
  var sending by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  val listState = rememberLazyListState()
  val scope = rememberCoroutineScope()

  fun absorb(array: org.json.JSONArray) {
    val fresh = (0 until array.length()).map { index ->
      val row = array.optJSONObject(index) ?: JSONObject()
      Message(
        id = row.optLong("id"),
        fromAdmin = row.optString("sender") == "admin",
        body = row.optString("body"),
        at = row.optLong("createdAt"),
        senderName = row.optString("senderName"),
      )
    }
    if (fresh.isEmpty()) return
    val known = messages.map { it.id }.toSet()
    messages = messages + fresh.filter { it.id !in known }
  }

  LaunchedEffect(thread.id) {
    while (true) {
      try {
        val after = messages.maxOfOrNull { it.id } ?: 0L
        val reply = withContext(Dispatchers.IO) { Api.supportThread(session, thread.id, after) }
        absorb(reply.items("messages"))
        error = ""
      } catch (e: Exception) {
        error = e.message ?: "وصل نشد"
      }
      delay(3_000)
    }
  }

  LaunchedEffect(messages.size) {
    if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
  }

  Column(Modifier.fillMaxSize().imePadding()) {
    Row(
      Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      IconButton(onClick = onBack) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "برگشت")
      }
      Column(Modifier.weight(1f)) {
        Text(thread.who.ifBlank { "بی‌نام" }, style = MaterialTheme.typography.titleMedium)
        if (error.isNotBlank()) {
          Text(error, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
      }
    }

    LazyColumn(
      Modifier.weight(1f).fillMaxWidth(),
      state = listState,
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      items(messages, key = { it.id }) { message -> Bubble(message) }
    }

    Row(
      Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      OutlinedTextField(
        value = draft,
        onValueChange = { draft = it },
        placeholder = { Text("جواب…") },
        modifier = Modifier.weight(1f),
        maxLines = 4,
      )
      IconButton(
        enabled = draft.isNotBlank() && !sending,
        onClick = {
          val text = draft.trim()
          if (text.isEmpty()) return@IconButton
          sending = true
          draft = ""
          scope.launch {
            try {
              val reply = withContext(Dispatchers.IO) { Api.supportReply(session, thread.id, text) }
              reply.o().optJSONObject("message")?.let { row ->
                val one = org.json.JSONArray().put(row)
                absorb(one)
              }
            } catch (e: Exception) {
              error = e.message ?: "نرفت"
              draft = text // پیامِ نرفته نباید گم شود
            } finally {
              sending = false
            }
          }
        },
      ) {
        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "فرستادن",
          modifier = Modifier.size(22.dp))
      }
    }
  }
}

@Composable
private fun Bubble(message: Message) {
  val mine = message.fromAdmin
  Row(
    Modifier.fillMaxWidth(),
    horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
  ) {
    Box(
      Modifier
        .widthIn(max = 280.dp)
        .clip(RoundedCornerShape(14.dp))
        .background(
          if (mine) MaterialTheme.colorScheme.primary
          else MaterialTheme.colorScheme.surfaceVariant
        )
        .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
      Column {
        Text(
          message.body,
          style = MaterialTheme.typography.bodyMedium,
          color = if (mine) MaterialTheme.colorScheme.onPrimary
          else MaterialTheme.colorScheme.onSurface,
        )
        Text(
          Ago.of(message.at),
          style = MaterialTheme.typography.labelSmall,
          color = if (mine) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
          else MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}
