package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.BuildConfig
import ir.vil3ntec.admin.work.Release
import ir.vil3ntec.admin.work.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 *  به‌روزرسانی از گیت‌هاب، داخلِ خودِ برنامه.
 *
 *  ⚠️ دکمه در حالِ دانلود غیرفعال نمی‌شود که «کنسل» شود — زدنِ دوباره‌اش
 *  همان دانلود را از جایی که مانده ادامه می‌دهد. روی اینترنتی که قطع و وصل
 *  می‌شود، همین تفاوتِ «تمام می‌شود» و «هیچ‌وقت تمام نمی‌شود» است.
 *
 *  ⚠️ و خودش یک بار، بی آنکه کسی دکمه بزند، سر می‌زند. «بررسی»ِ دستی سرِ
 *  جایش هست، ولی کسی که نمی‌داند باید دکمه بزند، هیچ‌وقت نمی‌فهمید نسخهٔ
 *  تازه‌ای آمده.
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
  var ready by remember { mutableStateOf(false) }

  val current = BuildConfig.VERSION_NAME

  fun check(quiet: Boolean = false) {
    if (checking) return
    checking = true
    if (!quiet) message = ""
    scope.launch {
      try {
        val found = withContext(Dispatchers.IO) { Updater.latest() }
        release = found
        // در حالتِ خودکار، «تازه‌ترین است» را نمی‌نویسیم؛ سکوت یعنی خبری نیست
        message = when {
          quiet -> message
          found == null -> "نسخه‌ای روی گیت‌هاب پیدا نشد"
          Updater.isNewer(found.version, current) -> ""
          else -> "همین نسخه تازه‌ترین است"
        }
      } catch (e: Exception) {
        if (!quiet) message = e.message ?: "بررسی نشد"
      } finally {
        checking = false
      }
    }
  }

  // یک بار با باز شدنِ صفحه، بی‌صدا
  LaunchedEffect(Unit) { check(quiet = true) }

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
        ready = true
        message = Updater.install(context, file) ?: ""
      } catch (e: Exception) {
        message = e.message ?: "دانلود نشد"
      } finally {
        downloading = false
      }
    }
  }

  val fresh = release
  val hasNew = fresh != null && Updater.isNewer(fresh.version, current)

  PanelCard {
    CardHeader(
      "به‌روزرسانی",
      "نسخهٔ این برنامه: $current",
    ) {
      RoundIcon(
        Icons.Filled.SystemUpdate,
        if (hasNew) StatusColor.good else MaterialTheme.colorScheme.primary,
        if (hasNew) StatusColor.goodTint else StatusColor.tint,
      )
    }

    if (hasNew && fresh != null) {
      Row(
        Modifier.fillMaxWidth().padding(top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Chip("نسخهٔ ${fresh.version}", StatusColor.good, StatusColor.goodTint)
        if (fresh.sizeBytes > 0) {
          Text(
            "  ${fresh.sizeBytes / (1024 * 1024)} مگابایت",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
      if (fresh.notes.isNotBlank()) {
        HorizontalDivider(Modifier.padding(vertical = 10.dp), color = StatusColor.border)
        Text(
          fresh.notes.lineSequence().filter { it.isNotBlank() }.take(8).joinToString("\n"),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    if (downloading) {
      LinearProgressIndicator(
        progress = { percent / 100f },
        trackColor = StatusColor.border,
        strokeCap = StrokeCap.Round,
        modifier = Modifier
          .fillMaxWidth()
          .height(7.dp)
          .padding(top = 12.dp)
          .clip(RoundedCornerShape(4.dp)),
      )
      Text(
        "$percent٪ — اگر قطع شد، دوباره بزنید؛ از همین‌جا ادامه می‌دهد",
        Modifier.padding(top = 6.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    if (message.isNotBlank()) {
      Text(
        message,
        Modifier.padding(top = 10.dp),
        style = MaterialTheme.typography.bodySmall,
        color = if (ready && !Updater.canInstall(context)) StatusColor.warn
        else MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 10.dp),
      horizontalArrangement = Arrangement.End,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TextButton(onClick = { check() }, enabled = !checking) {
        Text(if (checking) "در حال بررسی…" else "بررسی")
      }
      if (hasNew) {
        Button(onClick = { download() }, modifier = Modifier.padding(start = 8.dp)) {
          Text(
            when {
              downloading -> "ادامه"
              ready -> "نصب"
              else -> "دانلود و نصب"
            }
          )
        }
      }
    }
  }
}
