package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 *  خانه — «سرور در چه حالی است؟» در یک نگاه، و بس.
 *
 *  ⚠️ تنظیم‌ها از این‌جا رفتند به تبِ خودشان. صفحه‌ای که باید در یک نگاه
 *  جواب بدهد، نباید پر باشد از سوئیچ‌هایی که ماهی یک بار لمس می‌شوند.
 */
@Composable
fun HomeScreen(session: Session) {
  var data by remember { mutableStateOf<JSONObject?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  val serverState = rememberServerState(session.serverUrl, session.remote)

  LaunchedEffect(reload) {
    error = ""
    try {
      data = withContext(Dispatchers.IO) { Api.dashboard(session).o() }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  if (data == null && error.isNotBlank()) {
    ErrorState(error) { reload++ }
    return
  }
  if (data == null) {
    Loading()
    return
  }

  val info = data!!
  val server = info.optJSONObject("server") ?: JSONObject()
  val cpu = info.optJSONObject("cpu") ?: JSONObject()
  val memory = info.optJSONObject("memory") ?: JSONObject()
  val disk = info.optJSONObject("disk") ?: JSONObject()

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 24.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(Modifier.weight(1f)) {
          Text(
            server.optString("name").ifBlank { "سرور خانگی" },
            style = MaterialTheme.typography.headlineSmall,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
          )
          Text(
            "${session.username} · ${session.serverUrl.removePrefix("https://").removePrefix("http://")}",
            Modifier.padding(top = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
          )
        }
        // روشن یا خاموش — نبضِ مستقل، نه حدس از روی آخرین درخواست
        ServerStatusChip(serverState)
      }
    }

    item {
      PanelCard {
        CardHeader("وضعیت سرور")
        Meter("پردازنده", cpu.optDouble("usage", 0.0))
        Meter("حافظه", memory.optDouble("usedPercent", 0.0))
        Meter("دیسک", disk.optDouble("usedPercent", 0.0))
        HorizontalDivider(Modifier.padding(vertical = 10.dp), color = StatusColor.border)
        KeyValue("آدرس داخلی", server.optString("internalIp"))
        KeyValue("روشن بوده", uptime(server.optLong("uptimeSeconds")))
        KeyValue("سیستم", server.optString("platform"))
      }
    }

    item {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        TextButton(onClick = { reload++ }) { Text("تازه کردن") }
      }
    }
  }
}

private fun uptime(seconds: Long): String {
  if (seconds <= 0) return "—"
  val days = seconds / 86_400
  val hours = (seconds % 86_400) / 3_600
  val minutes = (seconds % 3_600) / 60
  return when {
    days > 0 -> "$days روز و $hours ساعت"
    hours > 0 -> "$hours ساعت و $minutes دقیقه"
    else -> "$minutes دقیقه"
  }
}
