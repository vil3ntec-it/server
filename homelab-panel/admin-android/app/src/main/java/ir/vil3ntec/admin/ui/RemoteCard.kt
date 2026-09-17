package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
 *  ⚠️ کلید باید از داخلِ خانه گرفته شود — درِ مدیر عمداً اجازهٔ صدورِ کلید
 *  از بیرون را نمی‌دهد. پس این کارت وقتی مفید است که همین حالا روی وای‌فایِ
 *  خانه باشید، و خودش هم همین را می‌گوید.
 */
@Composable
fun RemoteCard(session: Session, onChanged: (Session) -> Unit) {
  val context = LocalContext.current
  val store = remember { (context.applicationContext as AdminApp).store }
  val scope = rememberCoroutineScope()

  var tunnelUrl by remember { mutableStateOf("") }
  var running by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf("") }
  var ready by remember { mutableStateOf(session.remote?.usable == true) }

  LaunchedEffect(Unit) {
    runCatching {
      val info = withContext(Dispatchers.IO) { Remote.status(session) }
      tunnelUrl = info.optString("url")
      running = info.optBoolean("running")
    }
  }

  Card(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp)) {
      Text("دسترسی از بیرونِ خانه", style = MaterialTheme.typography.titleMedium)

      Text(
        if (ready) "این گوشی کلیدِ خودش را دارد؛ بیرون از خانه هم به کلِ سرور می‌رسد."
        else "برای وصل شدن از بیرونِ خانه، این گوشی یک کلیدِ مخصوصِ خودش لازم دارد.",
        Modifier.padding(top = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      if (tunnelUrl.isNotBlank()) {
        Text(
          tunnelUrl,
          Modifier.padding(top = 8.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.primary,
        )
      } else {
        Text(
          "هنوز آدرسِ اینترنتی (تونل) روی سرور راه نیفتاده — اول آن را در پنل روشن کنید.",
          Modifier.padding(top = 8.dp),
          style = MaterialTheme.typography.labelSmall,
          color = StatusColor.warn,
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
        if (ready) {
          TextButton(onClick = {
            store.clearRemote()
            ready = false
            message = "کلیدِ این گوشی پاک شد. باطل کردنش روی سرور، از پنل انجام می‌شود."
            onChanged(session.copy(remote = null))
          }) { Text("پاک کردنِ کلید") }
        }

        Button(
          enabled = !busy && running && tunnelUrl.isNotBlank(),
          onClick = {
            busy = true
            message = ""
            scope.launch {
              try {
                val access = withContext(Dispatchers.IO) {
                  Remote.provision(session, store.deviceId, "ویلن ادمین")
                }
                if (access == null) {
                  message = "سرور آدرسِ بیرونی نداد — تونل روشن است؟"
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
}
