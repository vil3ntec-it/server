package ir.vil3ntec.admin.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/*
 *  ══ اشتراک‌ها — داخلِ بخشِ خودِ هر برنامه ═════════════════════════════════
 *
 *  خواستهٔ صاحبِ سامانه (۱۴۰۵/۰۷/۱۳): «اشتراک‌ها رو توی بخشِ مربوطه‌شون بذار
 *  که راحت بشه دید و پیدا کرد… توی بخشِ پمپ بنزین هم باشه.»
 *
 *  ⛔ **و ریشهٔ واقعی**: «اشتراک بده»ِ قدیمیِ بخشِ پمپ هیچ‌وقت درست کار
 *  نمی‌کرد — شناسهٔ **کاربر** را به‌جای شناسهٔ **پمپ** می‌فرستاد، با
 *  `planCode`/`months` که سرورِ حساب اصلاً نمی‌خواند. و لغو، تمدید و تاریخِ
 *  پایان هیچ‌جا نبود.
 *
 *  ⛔ **دفترِ دوم و قاعدهٔ دوم ساخته نشد**: همان مسیرهای پنلِ وب
 *  (`/api/account-admin/customers` · `/grant-targets` · `/subs/<بخش>/…`)
 *  که با سرورهای واقعی سنجیده شده‌اند. روزِ مانده، حال و پلن از خودِ سرورِ
 *  حساب می‌آیند؛ این‌جا هیچ عددی حساب نمی‌شود.
 *
 *  ⛔ هر کارِ اثرگذار پنجرهٔ تأیید دارد که **پیامدش** را می‌گوید.
 */

private data class SubItem(
  val id: String,
  val app: String,
  val tenantId: String,
  val tenant: String,
  val owner: String,
  val email: String,
  val plan: String,
  val status: String,
  val daysLeft: Int,
  val endsAt: Long,
  val permanent: Boolean,
  val never: Boolean,
  val createdAt: Long,
)

private data class PlanItem(val code: String, val title: String, val price: String)

private enum class SubFilter(val title: String) {
  All("همه"), Active("فعال"), Soon("رو به پایان"), Ended("تمام/لغو"), None("بی‌اشتراک"),
}

/** یک کارِ اثرگذار، با پیامدش. */
private data class Deed(val title: String, val consequence: String, val danger: Boolean, val run: () -> Unit)

@Composable
fun SubscriptionsTab(session: Session, app: String, initialQuery: String = "") {
  var rows by remember { mutableStateOf<List<SubItem>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var query by remember(initialQuery) { mutableStateOf(initialQuery) }
  var filter by remember { mutableStateOf(SubFilter.All) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  var ask by remember { mutableStateOf<Deed?>(null) }
  var granting by remember { mutableStateOf<SubItem?>(null) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(app, reload) {
    error = ""
    try {
      rows = withContext(Dispatchers.IO) { readSubs(Api.customers(session, app)) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  fun act(done: String, block: () -> Unit) {
    if (busy) return
    busy = true
    scope.launch {
      note = try {
        withContext(Dispatchers.IO) { block() }
        done
      } catch (e: Exception) {
        "❌ " + (e.message ?: "نشد")
      } finally {
        busy = false
      }
      reload++
    }
  }

  val visible = rows?.filter { r ->
    val q = query.trim()
    (q.isBlank() || listOf(r.tenant, r.owner, r.email, r.plan).any { it.contains(q, true) }) &&
      when (filter) {
        SubFilter.All -> true
        SubFilter.Active -> !r.never && r.status == "active"
        SubFilter.Soon -> !r.never && r.status == "active" && !r.permanent && r.daysLeft in 0..30
        SubFilter.Ended -> !r.never && (r.status == "cancelled" || r.status == "expired")
        SubFilter.None -> r.never
      }
  }

  Column(Modifier.fillMaxSize()) {
    OutlinedTextField(
      value = query,
      onValueChange = { query = it },
      placeholder = { Text("ایمیل، نام یا پلن…") },
      leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
      trailingIcon = {
        if (query.isNotBlank()) IconButton(onClick = { query = "" }) {
          Icon(Icons.Filled.Close, contentDescription = "پاک کردن")
        }
      },
      singleLine = true,
      shape = MaterialTheme.shapes.medium,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp),
    )
    Row(
      Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      SubFilter.entries.forEach { f ->
        val n = rows?.count { r ->
          when (f) {
            SubFilter.All -> true
            SubFilter.Active -> !r.never && r.status == "active"
            SubFilter.Soon -> !r.never && r.status == "active" && !r.permanent && r.daysLeft in 0..30
            SubFilter.Ended -> !r.never && (r.status == "cancelled" || r.status == "expired")
            SubFilter.None -> r.never
          }
        } ?: 0
        FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text("${f.title} · $n") })
      }
    }

    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 28.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      item {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          Button(enabled = !busy, onClick = {
            granting = SubItem("", app, "", "", "", query.trim(), "", "none", 0, 0, false, true, 0)
          }) { Text("دادنِ اشتراک") }
        }
      }
      if (note.isNotBlank()) item { PanelCard { Text(note, style = MaterialTheme.typography.bodySmall) } }
      when {
        rows == null && error.isNotBlank() -> item { ErrorState(error) { reload++ } }
        rows == null -> item { PanelCard { Text("در حال گرفتن…") } }
        visible.isNullOrEmpty() -> item {
          PanelCard { CardHeader("چیزی نیست", if (query.isBlank()) "در این دسته حسابی نیست." else "«$query» پیدا نشد.") }
        }
        else -> items(safeKeys(visible) { "${it.app}:${it.id}" }, key = { it.first }) { (_, r) ->
          SubCard(
            r, busy,
            onGrant = { granting = r },
            onExtend = {
              ask = Deed("تمدیدِ یک ماه — ${r.tenant}",
                "یک ماهِ تقویمی از پایانِ فعلی جلو می‌رود. برنامهٔ مشتری در یک دقیقه خودش می‌فهمد.", false) {
                act("✅ یک ماه تمدید شد.") { Api.subExtend(session, r.app, r.id) }
              }
            },
            onStatus = { status ->
              ask = when (status) {
                "cancelled" -> Deed("لغو / حذفِ اشتراک — ${r.tenant}",
                  "اشتراک همین حالا برداشته می‌شود و قابلیت‌های پولی بسته می‌شوند — دورهٔ آزمایشی هم برنمی‌گردد. " +
                    "دادهٔ مشتری دست نمی‌خورد و با اشتراکِ تازه همه‌چیز برمی‌گردد.", true) {
                  act("✅ اشتراک لغو شد.") { Api.subStatus(session, r.app, r.id, "cancelled") }
                }
                "suspended" -> Deed("تعلیق — ${r.tenant}",
                  "برنامهٔ مشتری فقط‌خواندنی می‌شود؛ هیچ داده‌ای پاک نمی‌شود و روزهای مانده نگه داشته می‌شوند.", true) {
                  act("✅ تعلیق شد.") { Api.subStatus(session, r.app, r.id, "suspended") }
                }
                else -> Deed("فعال کردنِ دوباره — ${r.tenant}", "همان اشتراک با همان روزها برمی‌گردد.", false) {
                  act("✅ دوباره فعال شد.") { Api.subStatus(session, r.app, r.id, "active") }
                }
              }
            },
          )
        }
      }
    }
  }

  ask?.let { d ->
    AlertDialog(
      onDismissRequest = { ask = null },
      title = { Text(d.title) },
      text = { Text(d.consequence, style = MaterialTheme.typography.bodyMedium) },
      confirmButton = {
        TextButton(onClick = { ask = null; d.run() }) {
          Text("تایید", color = if (d.danger) StatusColor.bad else MaterialTheme.colorScheme.primary)
        }
      },
      dismissButton = { TextButton(onClick = { ask = null }) { Text("انصراف") } },
    )
  }

  granting?.let { target ->
    GrantPlanDialog(
      session = session,
      app = app,
      target = target,
      onDismiss = { granting = null },
      onDone = { msg -> granting = null; note = msg; reload++ },
    )
  }
}

@Composable
private fun SubCard(
  r: SubItem,
  busy: Boolean,
  onGrant: () -> Unit,
  onExtend: () -> Unit,
  onStatus: (String) -> Unit,
) {
  val ended = r.status == "cancelled" || r.status == "expired"
  val tone: Color = when {
    r.never && r.status != "trial" -> MaterialTheme.colorScheme.onSurfaceVariant
    ended -> StatusColor.bad
    r.status == "suspended" -> StatusColor.warn
    !r.permanent && r.daysLeft in 0..7 -> StatusColor.warn
    else -> StatusColor.good
  }
  val tint = when {
    r.never && r.status != "trial" -> StatusColor.tint
    ended -> StatusColor.badTint
    r.status == "suspended" || (!r.permanent && r.daysLeft in 0..7) -> StatusColor.warnTint
    else -> StatusColor.goodTint
  }
  val days = when {
    r.never && r.status != "trial" -> "بی‌اشتراک"
    r.status == "cancelled" -> "لغو شد — روزی نمانده"
    r.status == "expired" -> "تمام شد"
    r.permanent -> "دائمی"
    r.status == "suspended" -> "تعلیق · ${r.daysLeft} روز نگه داشته"
    r.status == "trial" -> "آزمایشی · ${r.daysLeft} روز مانده"
    else -> "${r.daysLeft} روز مانده"
  }

  PanelCard {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Avatar(r.tenant, tone, tint)
      Column(Modifier.weight(1f).padding(start = 12.dp)) {
        Text(r.tenant.ifBlank { r.owner.ifBlank { "بی‌نام" } },
          style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(listOf(r.owner, r.email).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "—" },
          Modifier.padding(top = 2.dp), style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Chip(days, tone, tint)
    }
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Chip(r.plan.ifBlank { "—" }, MaterialTheme.colorScheme.primary, StatusColor.tint)
      Chip(statusTitle(r.status), tone, tint)
      if (r.endsAt > 0 && !r.permanent) Chip("پایان: ${dateOf(r.endsAt)}", MaterialTheme.colorScheme.onSurfaceVariant, StatusColor.tint)
    }
    Row(
      Modifier.fillMaxWidth().padding(top = 8.dp).horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End),
    ) {
      //  ⛔ روی حسابِ بی‌اشتراک هیچ کارِ اشتراکی معنا ندارد — مستقیم «دادن»
      if (r.never || ended) {
        Button(enabled = !busy, onClick = onGrant) { Text(if (r.never) "دادنِ اشتراک" else "اشتراکِ تازه") }
      } else {
        OutlinedButton(enabled = !busy, onClick = onExtend) { Text("تمدید یک ماه") }
        if (r.status == "suspended") OutlinedButton(enabled = !busy, onClick = { onStatus("active") }) { Text("فعال کن") }
        if (r.status == "active") OutlinedButton(enabled = !busy, onClick = { onStatus("suspended") }) { Text("تعلیق") }
        OutlinedButton(enabled = !busy, onClick = { onStatus("cancelled") }) { Text("لغو / حذف", color = StatusColor.bad) }
      }
    }
  }
}

/**
 *  دادنِ اشتراک: حساب (با ایمیل) ← پلن ← ثبت.
 *
 *  ⛔ `days` و `features` فرستاده نمی‌شوند — سرورِ حساب مدت و فهرستِ
 *  قابلیت‌ها را از **خودِ پلن** برمی‌دارد. فرستادنِ روزِ دستی فهرست را خالی
 *  می‌گذاشت و خالی یعنی «پلنِ کامل» — «استاندارد دادم، وی‌آی‌پی گرفت».
 */
@Composable
private fun GrantPlanDialog(
  session: Session,
  app: String,
  target: SubItem,
  onDismiss: () -> Unit,
  onDone: (String) -> Unit,
) {
  var q by remember { mutableStateOf(target.email.ifBlank { target.tenant }) }
  var tenants by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
  var tenantId by remember { mutableStateOf(target.tenantId) }
  var tenantName by remember { mutableStateOf(target.tenant) }
  var plans by remember { mutableStateOf<List<PlanItem>?>(null) }
  var plan by remember { mutableStateOf("") }
  var err by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(app) {
    plans = try { withContext(Dispatchers.IO) { readPlans(Api.accountPlans(session, app), app) } }
    catch (e: Exception) { err = e.message ?: "پلن‌ها نیامدند"; emptyList() }
  }
  LaunchedEffect(q) {
    if (target.tenantId.isNotBlank()) return@LaunchedEffect
    tenants = try {
      withContext(Dispatchers.IO) {
        val arr = Api.grantTargets(session, app, q.trim()).items("items")
        (0 until arr.length()).mapNotNull { i ->
          val o = arr.optJSONObject(i) ?: return@mapNotNull null
          o.optString("tenantId") to listOf(o.optString("tenantName"), o.optString("ownerEmail"))
            .filter { it.isNotBlank() }.joinToString(" · ")
        }
      }
    } catch (_: Exception) { emptyList() }
  }

  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("دادنِ اشتراک") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (target.tenantId.isBlank()) {
          OutlinedTextField(value = q, onValueChange = { q = it; tenantId = "" }, singleLine = true,
            label = { Text("ایمیل یا نامِ حساب") }, modifier = Modifier.fillMaxWidth())
          tenants.take(5).forEach { (id, label) ->
            FilterChip(selected = tenantId == id, onClick = { tenantId = id; tenantName = label },
              label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) })
          }
        } else {
          Text("حساب: ${target.tenant}${if (target.email.isNotBlank()) " · ${target.email}" else ""}",
            style = MaterialTheme.typography.bodyMedium)
        }
        Text("پلن:", style = MaterialTheme.typography.labelLarge)
        when {
          plans == null -> Text("در حال گرفتن…")
          plans!!.isEmpty() -> Text("پلنی نیامد${if (err.isNotBlank()) " — $err" else ""}", color = StatusColor.bad)
          else -> plans!!.forEach { p ->
            FilterChip(selected = plan == p.code, onClick = { plan = p.code },
              label = { Text(listOf(p.title, p.price).filter { it.isNotBlank() }.joinToString(" · ")) })
          }
        }
        if (tenantId.isNotBlank() && plan.isNotBlank()) {
          Text("اشتراکِ «${plans?.firstOrNull { it.code == plan }?.title ?: plan}» به نامِ $tenantName ثبت می‌شود؛ " +
            "مدت و قابلیت‌ها از خودِ پلن. اگر اشتراکِ فعلی هنوز اعتبار دارد، از پایانِ همان جلو می‌رود.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (err.isNotBlank() && plans?.isNotEmpty() == true) Text("❌ $err", color = StatusColor.bad)
      }
    },
    confirmButton = {
      TextButton(enabled = !busy && tenantId.isNotBlank() && plan.isNotBlank(), onClick = {
        busy = true
        scope.launch {
          try {
            withContext(Dispatchers.IO) { Api.subGrant(session, app, tenantId, plan) }
            onDone("✅ اشتراک به $tenantName داده شد — برنامهٔ مشتری در یک دقیقه خودش می‌گیرد.")
          } catch (e: Exception) {
            err = e.message ?: "نشد"
          } finally { busy = false }
        }
      }) { Text(if (busy) "در حالِ ثبت…" else "ثبتِ اشتراک") }
    },
    dismissButton = { TextButton(onClick = onDismiss) { Text("بستن") } },
  )
}

/* ------------------------------ خواندنِ داده ------------------------------ */

/**
 *  ⛔ «فقط آخرین اشتراکِ هر حساب»: حسابی که یک بار لغو و دوباره خریده دو ردیف
 *  دارد و حالِ **امروزش** فقط یکی از آن‌هاست.
 */
private fun readSubs(reply: Api.Reply): List<SubItem> {
  val arr = reply.items("subscriptions")
  val all = (0 until arr.length()).mapNotNull { i ->
    val o = arr.optJSONObject(i) ?: return@mapNotNull null
    SubItem(
      id = o.optString("id"),
      app = o.optString("app"),
      tenantId = o.optString("tenantId"),
      tenant = o.optString("tenantName"),
      owner = o.optString("ownerName"),
      email = o.optString("ownerEmail"),
      plan = o.optString("planTitle").ifBlank { o.optString("plan") },
      status = o.optString("status"),
      daysLeft = o.optInt("daysLeft"),
      endsAt = o.optLong("endsAt"),
      permanent = o.optBoolean("permanent"),
      never = o.optBoolean("neverSubscribed"),
      createdAt = o.optLong("createdAt", o.optLong("startsAt")),
    )
  }
  return all.groupBy { "${it.app}:${it.tenantId}" }
    .map { (_, list) -> list.maxByOrNull { it.createdAt }!! }
    .sortedWith(compareBy<SubItem> { it.never }.thenBy { if (it.status == "active") 0 else 1 }.thenBy { it.daysLeft })
}

/**
 *  همان قاعدهٔ `GrantSub.tsx`ی پنلِ وب: فقط پلنِ فعال، و «رایگان» نه.
 *  ⚠️ `active` از سرورِ حساب گاهی `true` است و گاهی `1` — `optBoolean`
 *  عددِ ۱ را «نه» می‌خواند، پس هر دو شکل جدا سنجیده می‌شوند.
 */
private fun readPlans(reply: Api.Reply, app: String): List<PlanItem> {
  val arr = reply.items("plans")
  val cfg = reply.o().optJSONObject("config")
  val currency = if (app == "pump") cfg?.optString("pump_currency").orEmpty().ifBlank { "USD" }
    else cfg?.optString("currency").orEmpty().ifBlank { "AFN" }
  return (0 until arr.length()).mapNotNull { i ->
    val o = arr.optJSONObject(i) ?: return@mapNotNull null
    val active = when (val a = o.opt("active")) {
      is Boolean -> a
      is Number -> a.toInt() != 0
      is String -> a == "true" || a == "1"
      else -> true
    }
    if (!active) return@mapNotNull null
    val code = o.optString("code").ifBlank { return@mapNotNull null }
    if (code.equals("free", true)) return@mapNotNull null
    val price = if (o.has("price") && !o.isNull("price")) "${o.optString("price")} $currency" else ""
    PlanItem(code, o.optString("title").ifBlank { code }, price)
  }
}

private fun statusTitle(status: String): String = when (status) {
  "active" -> "فعال"
  "trial" -> "آزمایشی"
  "suspended" -> "تعلیق"
  "cancelled" -> "لغو"
  "expired" -> "تمام‌شده"
  "none", "" -> "بی‌اشتراک"
  else -> status
}

private fun dateOf(millis: Long): String {
  if (millis <= 0) return "—"
  val c = Calendar.getInstance(TimeZone.getDefault(), Locale.US).apply { timeInMillis = millis }
  return String.format(Locale.US, "%04d/%02d/%02d",
    c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
}
