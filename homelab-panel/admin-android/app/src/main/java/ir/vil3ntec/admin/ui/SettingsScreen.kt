package ir.vil3ntec.admin.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.NotificationsActive
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
import androidx.compose.runtime.getValue
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
import ir.vil3ntec.admin.BuildConfig
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import ir.vil3ntec.admin.work.CrashLog
import ir.vil3ntec.admin.work.Updater
import ir.vil3ntec.admin.work.WatchService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 *  تنظیمات — هر چیزی که «کار با سرور» نیست.
 *
 *  ⚠️ چرا جدا شد: همهٔ این‌ها تا دیروز تهِ صفحهٔ خانه بودند، زیرِ نمودارهای
 *  پردازنده و حافظه. یعنی صفحه‌ای که باید در یک نگاه بگوید «سرور در چه
 *  حالی است»، پر بود از چیزهایی که ماهی یک بار به‌شان دست می‌زنید — و
 *  خودِ تنظیم‌ها هم جایی که آدم دنبالشان می‌گردد نبودند.
 *
 *  حالا خانه فقط وضعیت است و این‌جا تنظیمات.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
  session: Session,
  onLogout: () -> Unit,
  onSession: (Session) -> Unit,
  themeMode: ThemeMode,
  onThemeMode: (ThemeMode) -> Unit,
) {
  val context = LocalContext.current
  val store = remember { (context.applicationContext as AdminApp).store }
  var watching by remember { mutableStateOf(store.watchEnabled) }
  var crash by remember { mutableStateOf(CrashLog.last(context)) }
  val scope = rememberCoroutineScope()

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Text("تنظیمات", style = MaterialTheme.typography.headlineSmall)
    }

    /* ------------------------------ حساب ------------------------------- */

    item {
      PanelCard {
        CardHeader("حسابِ شما") { RoundIcon(Icons.Filled.AccountCircle) }
        Row(
          Modifier.fillMaxWidth().padding(top = 12.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Avatar(session.username)
          Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(
              session.username.ifBlank { "مدیر" },
              style = MaterialTheme.typography.bodyLarge,
            )
            Text(
              session.serverUrl.removePrefix("https://").removePrefix("http://"),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
          }
          Chip(
            if (session.role == "admin") "مدیر" else session.role,
            MaterialTheme.colorScheme.primary,
            StatusColor.tint,
          )
        }
        Row(
          Modifier.fillMaxWidth().padding(top = 10.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          OutlinedButton(onClick = {
            scope.launch {
              runCatching {
                withContext(Dispatchers.IO) {
                  Api.call(session, "/api/auth/logout", "POST", JSONObject())
                }
              }
              onLogout()
            }
          }) { Text("خروج از حساب", color = StatusColor.bad) }
        }
      }
    }

    /* ------------------------------ ظاهر ------------------------------- */

    item {
      PanelCard {
        CardHeader("ظاهرِ برنامه", "روشن، تاریک، یا هرچه گوشی می‌گوید.") {
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

    /* ----------------------------- اعلان‌ها ---------------------------- */

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

    /* ------------------------ دسترسی از بیرون -------------------------- */

    item { RemoteCard(session, onChanged = onSession) }

    /* ---------------------------- به‌روزرسانی --------------------------- */

    item { UpdateCard() }

    /*
     *  ⚠️ سوئیچِ «نصبِ برنامه‌های ناشناس» جدا نشان داده می‌شود و نه فقط
     *  وقتی نصب شکست خورد: کسی که تازه برنامه را نصب کرده باید *پیش از*
     *  اولین به‌روزرسانی بداند این یک بار لازم است، نه وسطِ کار.
     */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !Updater.canInstall(context)) {
      item {
        PanelCard {
          CardHeader(
            "اجازهٔ نصب",
            "اندروید تا این سوئیچ روشن نشود، نمی‌گذارد برنامه خودش را به‌روز کند.",
          ) { RoundIcon(Icons.Filled.Info, StatusColor.warn, StatusColor.warnTint) }
          Row(
            Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.End,
          ) {
            OutlinedButton(onClick = { Updater.askInstallPermission(context) }) {
              Text("باز کردنِ تنظیمات")
            }
          }
        }
      }
    }

    /* ----------------------------- گزارشِ کِرَش -------------------------- */

    crash?.let { text ->
      item {
        PanelCard {
          CardHeader(
            "برنامه بارِ قبل بسته شد",
            "دلیلش این‌جا ثبت شده — کپی کنید و بفرستید تا درست شود.",
          ) { RoundIcon(Icons.Filled.BugReport, StatusColor.bad, StatusColor.badTint) }
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
              onClick = { copyText(context, "گزارشِ ویلن ادمین", text) },
              modifier = Modifier.padding(start = 8.dp),
            ) { Text("کپی") }
          }
        }
      }
    }

    /* ------------------------------ درباره ----------------------------- */

    item {
      PanelCard {
        CardHeader("درباره") { RoundIcon(Icons.Filled.Info) }
        KeyValue("نسخهٔ برنامه", BuildConfig.VERSION_NAME)
        KeyValue("آدرسِ سرور", session.serverUrl.removePrefix("https://").removePrefix("http://"))
        KeyValue("دسترسی از بیرون", if (session.remote?.usable == true) "آماده" else "ندارد")
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = StatusColor.border)
        KeyValue("شناسهٔ این گوشی", store.deviceId)
        Text(
          "این شناسه برای باطل کردنِ کلیدِ همین گوشی از پنل به کار می‌آید.",
          Modifier.padding(top = 4.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

internal fun copyText(context: Context, label: String, text: String) {
  runCatching {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    manager?.setPrimaryClip(ClipData.newPlainText(label, text))
  }
}
