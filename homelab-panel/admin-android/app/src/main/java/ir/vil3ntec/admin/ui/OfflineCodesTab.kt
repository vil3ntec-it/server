package ir.vil3ntec.admin.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/*
 *  ══ کدِ اشتراکِ آفلاینِ پمپ — در جیب ══════════════════════════════════════
 *
 *  خواستهٔ صاحبِ سامانه (۱۴۰۵/۰۷/۱۵): «توی برنامهٔ نیتیوِ اندرویدِ سرور هم
 *  این باشه تا اگه کامپیوتر پیشم نبود از برنامه بگیرم و بدم به طرف.»
 *
 *  ⛔ **همان درهای پنلِ وب** (`/api/account-admin/offline-codes`) — سرورِ
 *  حساب امضا می‌کند، نه این برنامه. هیچ کلید و هیچ رازی این‌جا نیست.
 *  ⛔ کدِ خام فقط همین یک بار (پاسخِ ساختن) دیده می‌شود؛ فهرست فقط سریال و
 *  کدِ کامپیوتر را دارد — همان قاعدهٔ سرور.
 *  ⛔ کد فقط روی **همان** کامپیوتری کار می‌کند که کدش زده شده؛ نویسهٔ آخرِ
 *  کدِ کامپیوتر سنجش است و سرور خطای تایپ را همین‌جا رد می‌کند.
 */

private data class OfflineRow(
  val id: String,
  val computer: String,
  val planTitle: String,
  val permanent: Boolean,
  val endsAt: Long,
  val note: String,
  val status: String,
  val redeemedAt: Long,
  val createdAt: Long,
)

/** پاسخِ ساختن: کدِ خام، ردیف و فایلِ ‎.pumpkey‎ */
private data class MadeCode(val code: String, val row: OfflineRow, val file: JSONObject)

private val OFFLINE_PLANS = listOf(
  Triple("std", "استاندارد", "365"),
  Triple("vip", "وی‌آی‌پی", "365"),
  Triple("perm", "دائمی", ""),
)

private fun rowOf(o: JSONObject) = OfflineRow(
  id = o.optString("id"),
  computer = o.optString("computer"),
  planTitle = o.optString("planTitle").ifBlank { o.optString("plan") },
  permanent = o.optBoolean("permanent"),
  endsAt = o.optLong("endsAt"),
  note = o.optString("note"),
  status = o.optString("status"),
  redeemedAt = o.optLong("redeemedAt"),
  createdAt = o.optLong("createdAt"),
)

@Composable
fun OfflineCodesTab(session: Session) {
  var rows by remember { mutableStateOf<List<OfflineRow>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var making by remember { mutableStateOf(false) }
  var made by remember { mutableStateOf<MadeCode?>(null) }
  var revoking by remember { mutableStateOf<OfflineRow?>(null) }
  var note by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    try {
      val reply = withContext(Dispatchers.IO) { Api.offlineCodes(session) }
      val array = reply.items("codes")
      rows = (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::rowOf) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      PanelCard {
        CardHeader(
          "🔑 کدِ اشتراکِ آفلاین",
          "برای کامپیوتری که اینترنت ندارد. مشتری در برنامهٔ پمپ «پروفایل ← اشتراک و پلن‌ها» " +
            "کدِ کامپیوترش را می‌بیند؛ همان را این‌جا بزنید و کدِ ساخته‌شده را برایش بفرستید.",
        )
        Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
          Button(onClick = { making = true }) { Text("کدِ آفلاینِ تازه") }
        }
      }
    }
    if (note.isNotBlank()) item { PanelCard { Text(note, style = MaterialTheme.typography.bodySmall) } }
    when {
      rows == null && error.isNotBlank() -> item { ErrorState(error) { reload++ } }
      rows == null -> item { PanelCard { Text("در حال گرفتن…") } }
      rows!!.isEmpty() -> item {
        PanelCard { CardHeader("هنوز کدی ساخته نشده", "با «کدِ آفلاینِ تازه» نخستین کد را بسازید.") }
      }
      else -> items(safeKeys(rows!!) { it.id }, key = { it.first }) { (_, r) ->
        OfflineCard(r) { revoking = r }
      }
    }
  }

  if (making) {
    NewOfflineDialog(
      session = session,
      onDismiss = { making = false },
      onMade = { m -> making = false; made = m; note = ""; reload++ },
    )
  }

  made?.let { m -> MadeDialog(m) { made = null } }

  revoking?.let { r ->
    AlertDialog(
      onDismissRequest = { revoking = null },
      title = { Text("باطل کردنِ کدِ کامپیوترِ ${r.computer}") },
      text = {
        Text(
          "از این لحظه سرورِ حساب این کد را نمی‌پذیرد و برنامه وقتی آنلاین شد کد را کنار می‌گذارد. " +
            "کامپیوتری که هرگز آنلاین نشود تا پایانِ مهلتِ کد با آن کار می‌کند — کدِ آفلاین ذاتاً همین است.",
          style = MaterialTheme.typography.bodyMedium,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          val target = r
          revoking = null
          scope.launch {
            note = try {
              withContext(Dispatchers.IO) { Api.revokeOfflineCode(session, target.id) }
              "✅ کد باطل شد."
            } catch (e: Exception) {
              "❌ " + (e.message ?: "نشد")
            }
            reload++
          }
        }) { Text("باطل کن", color = StatusColor.bad) }
      },
      dismissButton = { TextButton(onClick = { revoking = null }) { Text("انصراف") } },
    )
  }
}

@Composable
private fun OfflineCard(r: OfflineRow, onRevoke: () -> Unit) {
  val now = System.currentTimeMillis()
  val revoked = r.status == "revoked"
  val expired = !r.permanent && r.endsAt in 1 until now
  PanelCard {
    CardHeader(
      r.planTitle + if (r.note.isNotBlank()) " · ${r.note}" else "",
      if (r.permanent) "دائمی" else "تا ${offlineDay(r.endsAt)}",
    )
    Text(
      r.computer,
      Modifier.padding(top = 6.dp),
      style = MonoDigits.copy(textDirection = TextDirection.Ltr),
      color = MaterialTheme.colorScheme.primary,
    )
    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      when {
        revoked -> Chip("باطل", StatusColor.bad, StatusColor.badTint)
        expired -> Chip("منقضی", StatusColor.warn, StatusColor.warnTint)
        else -> Chip("فعال", StatusColor.good, StatusColor.goodTint)
      }
      if (r.redeemedAt > 0) Chip("✅ سرور دید", StatusColor.good, StatusColor.goodTint)
      else Chip("هنوز آنلاین نشده", MaterialTheme.colorScheme.onSurfaceVariant, StatusColor.tint)
    }
    if (!revoked) {
      Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        OutlinedButton(onClick = onRevoke) { Text("باطل کن", color = StatusColor.bad) }
      }
    }
  }
}

@Composable
private fun NewOfflineDialog(session: Session, onDismiss: () -> Unit, onMade: (MadeCode) -> Unit) {
  var computer by remember { mutableStateOf("") }
  var plan by remember { mutableStateOf("vip") }
  var days by remember { mutableStateOf("365") }
  var memo by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()
  val perm = plan == "perm"

  AlertDialog(
    onDismissRequest = { if (!busy) onDismiss() },
    title = { Text("کدِ اشتراکِ آفلاینِ تازه") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
          "کد فقط روی همان کامپیوتری کار می‌کند که کدش را این‌جا می‌زنید، و بی اینترنت قفل‌ها را باز می‌کند.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
          value = computer,
          onValueChange = { computer = it.uppercase() },
          label = { Text("کدِ کامپیوترِ مشتری") },
          placeholder = { Text("XXXX-XXXX-XXXX-XXXX") },
          singleLine = true,
          textStyle = MonoDigits.copy(textDirection = TextDirection.Ltr),
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
          modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          OFFLINE_PLANS.forEach { (code, title, d) ->
            FilterChip(selected = plan == code, onClick = { plan = code; days = d }, label = { Text(title) })
          }
        }
        OutlinedTextField(
          value = if (perm) "همیشه" else days,
          onValueChange = { days = it.filter(Char::isDigit).take(4) },
          enabled = !perm,
          label = { Text("مدت به روز") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
          modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
          value = memo,
          onValueChange = { memo = it.take(300) },
          label = { Text("یادداشت (نامِ مشتری، پمپ…)") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        if (error.isNotBlank()) Text("❌ $error", color = StatusColor.bad, style = MaterialTheme.typography.bodySmall)
      }
    },
    confirmButton = {
      TextButton(enabled = !busy && computer.isNotBlank(), onClick = {
        busy = true
        error = ""
        scope.launch {
          try {
            val out = withContext(Dispatchers.IO) {
              Api.makeOfflineCode(session, plan, computer.trim(), if (perm) null else days.toIntOrNull(), memo.trim())
            }.o()
            onMade(MadeCode(
              out.optString("code"),
              rowOf(out.optJSONObject("offline") ?: JSONObject()),
              out.optJSONObject("file") ?: JSONObject(),
            ))
          } catch (e: Exception) {
            error = e.message ?: "نشد"
          } finally {
            busy = false
          }
        }
      }) { Text(if (busy) "…" else "ساختن") }
    },
    dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("انصراف") } },
  )
}

@Composable
private fun MadeDialog(m: MadeCode, onDismiss: () -> Unit) {
  val context = LocalContext.current
  val r = m.row
  val until = if (r.permanent) "" else " تا ${offlineDay(r.endsAt)}"
  val message = "کدِ اشتراکِ آفلاینِ برنامهٔ پمپ بنزین (${r.planTitle}$until) — فقط برای کامپیوترِ ${r.computer}:\n\n" +
    "${m.code}\n\nدر برنامه: پروفایل ← اشتراک و پلن‌ها ← کدِ اشتراکِ آفلاین ← چسباندن و «ثبتِ کد»."

  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("کدِ آفلاین ساخته شد") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
          "این کد را همین حالا بردارید — با بستنِ این پنجره دیگر دیده نمی‌شود.",
          color = StatusColor.warn,
          style = MaterialTheme.typography.bodySmall,
        )
        Text("${r.planTitle}$until · کامپیوترِ ${r.computer}", style = MaterialTheme.typography.bodySmall)
        SelectionContainer {
          Text(
            m.code,
            style = MonoDigits.copy(textDirection = TextDirection.Ltr),
            color = MaterialTheme.colorScheme.primary,
          )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          OutlinedButton(onClick = { copyText(context, m.code) }) { Text("کپیِ کد") }
          OutlinedButton(onClick = { shareText(context, message) }) { Text("ارسال (واتساپ…)") }
        }
        OutlinedButton(onClick = { shareKeyFile(context, r.computer, m.file) }) { Text("فرستادنِ فایلِ ‎.pumpkey‎") }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("برداشتم، ببند") } },
  )
}

private fun copyText(context: Context, value: String) {
  val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
  clipboard.setPrimaryClip(ClipData.newPlainText("code", value))
  Toast.makeText(context, "کپی شد", Toast.LENGTH_SHORT).show()
}

private fun shareText(context: Context, text: String) {
  val send = Intent(Intent.ACTION_SEND).apply {
    type = "text/plain"
    putExtra(Intent.EXTRA_TEXT, text)
  }
  runCatching { context.startActivity(Intent.createChooser(send, "ارسالِ کد")) }
    .onFailure { Toast.makeText(context, "برنامه‌ای برای ارسال پیدا نشد", Toast.LENGTH_SHORT).show() }
}

/**
 *  فایلِ ‎.pumpkey‎ — همان JSONی که پنلِ وب دانلود می‌کند.
 *
 *  ⚠️ از `cache/keys/` و همان `FileProvider`ِ برنامه (`file_paths.xml`)؛
 *  فایل بیرون از پوشهٔ خودِ برنامه نوشته نمی‌شود.
 */
private fun shareKeyFile(context: Context, computer: String, file: JSONObject) {
  runCatching {
    val dir = File(context.cacheDir, "keys").apply { mkdirs() }
    val safe = computer.filter { it.isLetterOrDigit() || it == '-' }.ifBlank { "code" }
    val out = File(dir, "pump-$safe.pumpkey")
    out.writeText(file.toString(2), Charsets.UTF_8)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", out)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = "application/octet-stream"
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, "فرستادنِ فایلِ کد"))
  }.onFailure { Toast.makeText(context, "فایل فرستاده نشد", Toast.LENGTH_SHORT).show() }
}

/** همان شکلِ تاریخِ زبانهٔ اشتراک‌ها (‎SubscriptionsTab.dateOf‎) */
private fun offlineDay(millis: Long): String {
  if (millis <= 0) return "—"
  val c = java.util.Calendar.getInstance(java.util.TimeZone.getDefault(), java.util.Locale.US)
    .apply { timeInMillis = millis }
  return String.format(java.util.Locale.US, "%04d/%02d/%02d",
    c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH))
}
