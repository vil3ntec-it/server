package ir.vil3ntec.admin.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

private data class LiveCode(
  val id: Long,
  val email: String,
  val appName: String,
  val purpose: String,
  val code: String,
  val expiresAt: Long,
  val status: String,
  val sendState: String,
  val auto: Boolean,
)

/**
 *  کدهای شش‌رقمی — همان فهرستِ زندهٔ پنل، در جیب.
 *
 *  ⚠️ خودش هر دو ثانیه تازه می‌شود و یک ساعتِ جدا هر ثانیه شمارشِ معکوس را
 *  جلو می‌برد. کد دو دقیقه بیشتر عمر نمی‌کند؛ فهرستی که دستی تازه شود،
 *  همیشه کدِ مرده نشان می‌دهد.
 */
@Composable
fun CodesScreen(session: Session) {
  var codes by remember { mutableStateOf<List<LiveCode>?>(null) }
  var error by remember { mutableStateOf("") }
  var onlyLive by remember { mutableStateOf(true) }
  var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
  val context = LocalContext.current

  LaunchedEffect(Unit) {
    while (true) {
      try {
        val reply = withContext(Dispatchers.IO) { Api.liveCodes(session) }
        val array = reply.items("items")
        codes = (0 until array.length()).map { index ->
          val row = array.optJSONObject(index) ?: JSONObject()
          LiveCode(
            id = row.optLong("id"),
            email = row.optString("email"),
            appName = row.optString("appName").ifBlank { row.optString("app") },
            purpose = row.optString("purpose"),
            code = row.optString("code"),
            expiresAt = row.optLong("expiresAt"),
            status = row.optString("status"),
            sendState = row.optString("sendState"),
            auto = row.optBoolean("autoResend"),
          )
        }
        error = ""
      } catch (e: Exception) {
        error = e.message ?: "وصل نشد"
      }
      // شمارشِ معکوس بینِ دو بار گرفتنِ داده هم باید جلو برود
      repeat(5) {
        delay(500)
        now = System.currentTimeMillis()
      }
    }
  }

  if (codes == null && error.isNotBlank()) {
    ErrorState(error) { }
    return
  }
  if (codes == null) {
    Loading()
    return
  }

  val shown = codes!!.filter { !onlyLive || (it.status == "live" && it.expiresAt > now) }

  Column(Modifier.fillMaxSize()) {
    Row(
      Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text("کدهای شش‌رقمی", style = MaterialTheme.typography.headlineSmall)
      FilterChip(
        selected = onlyLive,
        onClick = { onlyLive = !onlyLive },
        label = { Text("فقط زنده‌ها") },
      )
    }

    if (shown.isEmpty()) {
      EmptyState(
        "هنوز کسی کد نخواسته",
        "هر وقت کسی در یکی از برنامه‌هایتان ایمیلش را بزند، همین‌جا با کدش می‌آید.",
      )
      return
    }

    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      items(shown, key = { it.id }) { row -> CodeCard(row, now, context) }
    }
  }
}

@Composable
private fun CodeCard(row: LiveCode, now: Long, context: Context) {
  val left = ((row.expiresAt - now) / 1000).coerceAtLeast(0)
  val live = row.status == "live" && left > 0

  PanelCard {
    Row(
      Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f)) {
        Text(row.email, style = MaterialTheme.typography.bodyMedium, maxLines = 1,
          overflow = TextOverflow.Ellipsis)
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Chip(row.appName, MaterialTheme.colorScheme.primary, StatusColor.tint)
          Chip(sendLabel(row.sendState), sendColor(row.sendState), sendTint(row.sendState))
          if (row.auto) Chip("خودکار", MaterialTheme.colorScheme.onSurfaceVariant, StatusColor.tint)
        }
        if (live) {
          Text(
            "$left ثانیه تا انقضا",
            Modifier.padding(top = 6.dp),
            style = MaterialTheme.typography.labelSmall,
            color = if (left <= 15) StatusColor.warn else MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (row.code.isNotBlank()) {
          // کد بزرگ و هم‌عرض — ممکن است تلفنی خوانده شود
          Text(row.code, style = MonoDigits, color = MaterialTheme.colorScheme.primary)
          IconButton(onClick = { copy(context, row.code) }) {
            Icon(Icons.Filled.ContentCopy, contentDescription = "کپی", modifier = Modifier.size(18.dp))
          }
        } else {
          Text(statusLabel(row.status), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

private fun copy(context: Context, value: String) {
  val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
  clipboard.setPrimaryClip(ClipData.newPlainText("code", value))
  Toast.makeText(context, "کپی شد", Toast.LENGTH_SHORT).show()
}

private fun sendLabel(state: String) = when (state) {
  "sent" -> "رفت"
  "failed" -> "نرفت"
  "sending" -> "در حالِ رفتن"
  else -> "در صف"
}

/*
 *  ⚠️ @Composable لازم است: رنگِ وضعیت حالا به تمِ جاری بسته است (سبزِ
 *  تمِ تاریک با سبزِ تمِ روشن یکی نیست) و از CompositionLocal می‌آید.
 */
@Composable
private fun sendColor(state: String) = when (state) {
  "sent" -> StatusColor.good
  "failed" -> StatusColor.bad
  else -> StatusColor.warn
}

@Composable
private fun sendTint(state: String) = when (state) {
  "sent" -> StatusColor.goodTint
  "failed" -> StatusColor.badTint
  else -> StatusColor.warnTint
}

private fun statusLabel(status: String) = when (status) {
  "used" -> "استفاده شد"
  "replaced" -> "کدِ تازه آمد"
  else -> "منقضی شد"
}
