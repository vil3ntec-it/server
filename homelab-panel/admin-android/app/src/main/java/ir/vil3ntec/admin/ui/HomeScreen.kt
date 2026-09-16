package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.AdminApp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import ir.vil3ntec.admin.work.WatchService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 *  خانه — «سرور در چه حالی است؟» در یک نگاه، به‌علاوهٔ به‌روزرسانی و خروج.
 */
@Composable
fun HomeScreen(session: Session, onLogout: () -> Unit) {
  var data by remember { mutableStateOf<JSONObject?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableStateOf(0) }
  val context = LocalContext.current
  val store = remember { (context.applicationContext as AdminApp).store }
  var watching by remember { mutableStateOf(store.watchEnabled) }
  val scope = rememberCoroutineScope()
  val serverState = rememberServerState(session.serverUrl)

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
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
      ) {
        Column(Modifier.weight(1f)) {
          Text(server.optString("name").ifBlank { "سرور خانگی" },
            style = MaterialTheme.typography.headlineSmall)
          Text(
            "${session.username} · ${session.serverUrl}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        // روشن یا خاموش — نبضِ مستقل، نه حدس از روی آخرین درخواست
        ServerStatusChip(serverState)
      }
    }

    item {
      Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
          Text("وضعیت سرور", style = MaterialTheme.typography.titleMedium)
          Gauge("پردازنده", cpu.optDouble("usage", 0.0))
          Gauge("حافظه", memory.optDouble("usedPercent", 0.0))
          Gauge("دیسک", disk.optDouble("usedPercent", 0.0))
          HorizontalDivider(Modifier.padding(vertical = 8.dp))
          KeyValue("آدرس داخلی", server.optString("internalIp"))
          KeyValue("روشن بوده", uptime(server.optLong("uptimeSeconds")))
          KeyValue("سیستم", server.optString("platform"))
        }
      }
    }

    item {
      Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
          Text("نگهبانِ پیام‌ها", style = MaterialTheme.typography.titleMedium)
          Text(
            "تا برنامه بسته هم باشد، پیامِ تازهٔ پشتیبانی را اعلان می‌دهد.",
            Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(if (watching) "روشن" else "خاموش", style = MaterialTheme.typography.bodyMedium)
            Switch(
              checked = watching,
              onCheckedChange = { on ->
                watching = on
                store.watchEnabled = on
                if (on) WatchService.start(context) else WatchService.stop(context)
              },
            )
          }
        }
      }
    }

    item { UpdateCard() }

    item {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { reload++ }) { Text("تازه کردن") }
        TextButton(onClick = {
          scope.launch {
            runCatching { withContext(Dispatchers.IO) { Api.call(session, "/api/auth/logout", "POST", JSONObject()) } }
            onLogout()
          }
        }) { Text("خروج") }
      }
    }
  }
}

@Composable
private fun Gauge(label: String, percent: Double) {
  val value = (percent / 100.0).coerceIn(0.0, 1.0).toFloat()
  val color = when {
    percent >= 90 -> StatusColor.bad
    percent >= 70 -> StatusColor.warn
    else -> StatusColor.good
  }
  Column(Modifier.padding(top = 10.dp)) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(label, style = MaterialTheme.typography.labelMedium)
      Text("${percent.toInt()}٪", style = MaterialTheme.typography.labelMedium, color = color)
    }
    LinearProgressIndicator(
      progress = { value },
      color = color,
      modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
    )
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
