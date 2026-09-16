package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.BuildConfig
import ir.vil3ntec.admin.work.Release
import ir.vil3ntec.admin.work.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 *  کارتِ به‌روزرسانی.
 *
 *  ⚠️ دکمه در حالِ دانلود غیرفعال نمی‌شود که «کنسل» شود — زدنِ دوباره‌اش
 *  همان دانلود را از جایی که مانده ادامه می‌دهد. روی اینترنتی که قطع و وصل
 *  می‌شود، همین تفاوتِ «تمام می‌شود» و «هیچ‌وقت تمام نمی‌شود» است.
 */
@Composable
fun UpdateCard() {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()

  var release by remember { mutableStateOf<Release?>(null) }
  var checking by remember { mutableStateOf(false) }
  var downloading by remember { mutableStateOf(false) }
  var percent by remember { mutableIntStateOf(0) }
  var message by remember { mutableStateOf("") }

  val current = BuildConfig.VERSION_NAME

  fun check() {
    if (checking) return
    checking = true
    message = ""
    scope.launch {
      try {
        val found = withContext(Dispatchers.IO) { Updater.latest() }
        release = found
        message = when {
          found == null -> "نسخه‌ای روی گیت‌هاب پیدا نشد"
          Updater.isNewer(found.version, current) -> ""
          else -> "همین نسخه تازه‌ترین است"
        }
      } catch (e: Exception) {
        message = e.message ?: "بررسی نشد"
      } finally {
        checking = false
      }
    }
  }

  fun download() {
    val target = release ?: return
    if (downloading) return
    downloading = true
    message = ""
    scope.launch {
      try {
        val file = withContext(Dispatchers.IO) {
          Updater.download(context, target) { progress -> percent = progress.percent }
        }
        Updater.install(context, file)
      } catch (e: Exception) {
        message = e.message ?: "دانلود نشد"
      } finally {
        downloading = false
      }
    }
  }

  Card(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp)) {
      Text("به‌روزرسانی", style = MaterialTheme.typography.titleMedium)
      Text(
        "نسخهٔ این برنامه: $current",
        Modifier.padding(top = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      val fresh = release
      if (fresh != null && Updater.isNewer(fresh.version, current)) {
        Text(
          "نسخهٔ ${fresh.version} آماده است",
          Modifier.padding(top = 8.dp),
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.primary,
        )
        if (fresh.sizeBytes > 0) {
          Text(
            "${fresh.sizeBytes / (1024 * 1024)} مگابایت",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      if (downloading) {
        LinearProgressIndicator(
          progress = { percent / 100f },
          modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        Text(
          "$percent٪ — اگر قطع شد، دوباره بزنید؛ از همین‌جا ادامه می‌دهد",
          Modifier.padding(top = 4.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }

      if (message.isNotBlank()) {
        Text(
          message,
          Modifier.padding(top = 8.dp),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }

      Row(
        Modifier.fillMaxWidth().padding(top = 8.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        TextButton(onClick = { check() }, enabled = !checking) {
          Text(if (checking) "در حال بررسی…" else "بررسی")
        }
        if (fresh != null && Updater.isNewer(fresh.version, current)) {
          Button(onClick = { download() }, modifier = Modifier.padding(start = 8.dp)) {
            Text(if (downloading) "ادامه" else "دانلود و نصب")
          }
        }
      }
    }
  }
}
