package ir.vil3ntec.admin.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.AdminApp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import ir.vil3ntec.admin.work.CrashLog
import ir.vil3ntec.admin.work.WatchService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 *  خانه — «سرور در چه حالی است؟» در یک نگاه، به‌علاوهٔ تنظیم‌ها و خروج.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
  session: Session,
  onLogout: () -> Unit,
  /** وقتی کلیدِ دسترسی از بیرون گرفته شد، نشست باید همان لحظه تازه شود */
  onSession: (Session) -> Unit = {},
  /** تمی که کاربر انتخاب کرده — عوض که شد، کلِ برنامه باید عوض شود */
  themeMode: ThemeMode = ThemeMode.System,
  onThemeMode: (ThemeMode) -> Unit = {},
) {
  var data by remember { mutableStateOf<JSONObject?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  val context = LocalContext.current
  val store = remember { (context.applicationContext as AdminApp).store }
  var watching by remember { mutableStateOf(store.watchEnabled) }
  var crash by remember { mutableStateOf(CrashLog.last(context)) }
  val scope = rememberCoroutineScope()
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

    /*
     *  ⚠️ کارتِ کِرَش فقط وقتی هست که برنامه واقعاً افتاده باشد.
     *
     *  بارِ قبل تنها چیزی که دیده شد یک کادرِ «has stopped» بود و هیچ ردی
     *  نماند. حالا خودِ برنامه دلیلش را نگه می‌دارد و با یک دکمه کپی
     *  می‌شود — به‌جای وصل کردنِ گوشی به کامپیوتر و گرفتنِ logcat.
     */
    crash?.let { text ->
      item {
        PanelCard {
          CardHeader(
            "برنامه بارِ قبل بسته شد",
            "دلیلش این‌جا ثبت شده — کپی کنید و بفرستید تا درست شود.",
          ) { RoundIcon(Icons.Filled.PhoneAndroid, StatusColor.bad, StatusColor.badTint) }
          Text(
            text.lineSequence().take(6).joinToString("\n"),
            Modifier.padding(top = 10.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.End,
          ) {
            TextButton(onClick = {
              CrashLog.clear(context)
              crash = null
            }) { Text("پاک کن") }
            OutlinedButton(
              onClick = { copyToClipboard(context, "گزارشِ ویلن ادمین", text) },
              modifier = Modifier.padding(start = 8.dp),
            ) { Text("کپی") }
          }
        }
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
      PanelCard {
        CardHeader(
          "ظاهرِ برنامه",
          "روشن، تاریک، یا هرچه گوشی می‌گوید.",
        ) {
          RoundIcon(
            if (themeMode == ThemeMode.Dark) Icons.Filled.DarkMode else Icons.Filled.LightMode,
          )
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(top = 12.dp)) {
          ThemeMode.entries.forEachIndexed { index, mode ->
            SegmentedButton(
              selected = themeMode == mode,
              onClick = { onThemeMode(mode) },
              shape = SegmentedButtonDefaults.itemShape(index, ThemeMode.entries.size),
            ) { Text(mode.title) }
          }
        }
      }
    }

    item {
      PanelCard {
        CardHeader(
          "نگهبانِ پیام‌ها",
          "تا برنامه بسته هم باشد، پیامِ تازهٔ پشتیبانی را اعلان می‌دهد.",
        ) {
          RoundIcon(
            Icons.Filled.NotificationsActive,
            if (watching) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
            if (watching) StatusColor.goodTint else StatusColor.tint,
          )
        }
        Row(
          Modifier.fillMaxWidth().padding(top = 10.dp),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(
            if (watching) "روشن" else "خاموش",
            style = MaterialTheme.typography.bodyMedium,
            color = if (watching) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
          )
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

    item { RemoteCard(session, onChanged = onSession) }

    item { UpdateCard() }

    item {
      Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        TextButton(onClick = { reload++ }) { Text("تازه کردن") }
        TextButton(onClick = {
          scope.launch {
            runCatching {
              withContext(Dispatchers.IO) {
                Api.call(session, "/api/auth/logout", "POST", JSONObject())
              }
            }
            onLogout()
          }
        }) { Text("خروج", color = StatusColor.bad) }
      }
    }
  }
}

private fun copyToClipboard(context: Context, label: String, text: String) {
  runCatching {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    manager?.setPrimaryClip(ClipData.newPlainText(label, text))
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
