package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.AdminApp
import ir.vil3ntec.admin.data.Remote
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 *  «از بیرونِ خانه هم وصل شوم».
 *
 *  ⚠️ کلید معمولاً همان لحظهٔ ورود گرفته می‌شود و این کارت فقط نشانش
 *  می‌دهد. دکمهٔ «کلیدِ تازه» برای وقتی است که کلید را پاک کرده‌اید یا از
 *  پنل باطلش کرده‌اید.
 */
@Composable
fun RemoteCard(session: Session, onChanged: (Session) -> Unit) {
  val context = LocalContext.current
  val store = remember { (context.applicationContext as AdminApp).store }
  val scope = rememberCoroutineScope()

  var adminUrl by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf("") }
  var ready by remember { mutableStateOf(session.remote?.usable == true) }

  LaunchedEffect(Unit) {
    runCatching {
      val info = withContext(Dispatchers.IO) { Remote.status(session) }
      adminUrl = info.optString("adminUrl").ifBlank { info.optString("url") }
    }
  }

  PanelCard {
    CardHeader(
      "دسترسی از بیرونِ خانه",
      if (ready) "این گوشی کلیدِ خودش را دارد؛ هر جای دنیا به کلِ سرور می‌رسد."
      else "برای وصل شدن از بیرونِ خانه، این گوشی یک کلیدِ مخصوصِ خودش لازم دارد.",
    ) {
      RoundIcon(
        Icons.Filled.Key,
        if (ready) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
        if (ready) StatusColor.goodTint else StatusColor.tint,
      )
    }

    if (adminUrl.isNotBlank()) {
      Text(
        adminUrl,
        Modifier.padding(top = 10.dp),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    } else {
      Text(
        "هنوز دامنه‌ای روی سرور ثبت نشده — از پنل، بخشِ «دامنه‌ها» اضافه‌اش کنید.",
        Modifier.padding(top = 10.dp),
        style = MaterialTheme.typography.labelSmall,
        color = StatusColor.warn,
      )
    }

    if (message.isNotBlank()) {
      Text(
        message,
        Modifier.padding(top = 10.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 10.dp),
      horizontalArrangement = Arrangement.End,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (ready) {
        TextButton(onClick = {
          store.clearRemote()
          ready = false
          message = "کلیدِ این گوشی پاک شد. باطل کردنش روی سرور، از پنل انجام می‌شود."
          onChanged(session.copy(remote = null))
        }) { Text("پاک کردنِ کلید", color = StatusColor.bad) }
      }

      Button(
        enabled = !busy,
        modifier = Modifier.padding(start = 8.dp),
        onClick = {
          busy = true
          message = ""
          scope.launch {
            try {
              val access = withContext(Dispatchers.IO) {
                Remote.provision(session, store.deviceId, "ویلن ادمین")
              }
              if (access == null) {
                message = "سرور آدرسِ بیرونی نداد — دامنه در پنل ثبت شده؟"
              } else {
                store.saveRemote(access)
                ready = true
                message = "آماده شد. از این به بعد بیرون از خانه هم وصل می‌شوید."
                onChanged(session.copy(remote = access))
              }
            } catch (e: Exception) {
              message = e.message ?: "نشد"
            } finally {
              busy = false
            }
          }
        },
      ) {
        Text(if (ready) "کلیدِ تازه" else "آماده کن")
      }
    }
  }
}
