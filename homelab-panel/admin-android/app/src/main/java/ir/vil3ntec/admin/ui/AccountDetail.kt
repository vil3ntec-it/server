package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Ago
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/*
 *  ───────────────────── پروندهٔ یک حسابِ فروشگاه ─────────────────────
 *
 *  ⚠️ چرا ساخته شد: تا دیروز زدن روی یک حساب مستقیم یک کادرِ «چند روز
 *  اشتراک بدهم؟» باز می‌کرد. یعنی برای دیدنِ اینکه طرف *الان* چه دارد و
 *  چقدر مانده، هیچ راهی نبود — و کاری که خواسته نشده بود جلوی دست بود.
 *
 *  حالا زدن روی حساب، پروندهٔ او را باز می‌کند: چه اشتراکی دارد، چند روز
 *  مانده، قبلاً چه گرفته، با چند دستگاه وارد شده. دادنِ اشتراک یکی از
 *  کارهای داخلِ همین صفحه است، نه اولین چیزی که می‌بینید.
 */

private data class PlanOption(
  val code: String,
  val title: String,
  val amount: Int,
  val unit: String,
  val price: Double,
  val badge: String,
)

private data class SubRow(
  val id: Int,
  val title: String,
  val status: String,
  val startsAt: Long,
  val endsAt: Long,
)

/** «۳ ماه» / «۱ سال» — همان چیزی که آدم می‌گوید، نه day/month/year */
private fun spanOf(amount: Int, unit: String): String {
  val name = when (unit) {
    "day" -> "روز"
    "week" -> "هفته"
    "year" -> "سال"
    else -> "ماه"
  }
  return "$amount $name"
}

/**
 *  تاریخِ خوانا.
 *
 *  ⚠️ عمداً میلادیِ ساده و نه شمسی: تبدیلِ درستِ تقویم یک کتابخانهٔ کامل
 *  می‌خواهد و نیمه‌کاره‌اش بدتر از نبودنش است. چیزی که واقعاً لازم است —
 *  «چند روز مانده» — بالای صفحه و درشت آمده.
 */
private fun dateOf(millis: Long): String {
  if (millis <= 0) return "—"
  val c = Calendar.getInstance(TimeZone.getDefault(), Locale.US).apply { timeInMillis = millis }
  return String.format(
    Locale.US, "%04d/%02d/%02d",
    c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
  )
}

private fun statusTitle(status: String): String = when (status) {
  "active" -> "فعال"
  "expired" -> "تمام‌شده"
  "cancelled" -> "لغو‌شده"
  "paused" -> "متوقف"
  else -> status.ifBlank { "—" }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShopAccountDetail(
  session: Session,
  accountId: String,
  fallbackName: String,
  onBack: () -> Unit,
  /** وقتی چیزی عوض شد، فهرستِ پشتِ سر هم باید تازه شود */
  onChanged: () -> Unit,
) {
  var data by remember { mutableStateOf<JSONObject?>(null) }
  var plans by remember { mutableStateOf<List<PlanOption>>(emptyList()) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  LaunchedEffect(accountId, reload) {
    error = ""
    try {
      data = withContext(Dispatchers.IO) { Api.shopAccount(session, accountId).o() }
      // پلن‌ها یک بار کافی است و نبودنشان نباید صفحه را بخواباند
      if (plans.isEmpty()) {
        runCatching {
          withContext(Dispatchers.IO) { Api.plans(session).items("items") }
        }.getOrNull()?.let { plans = readPlans(it) }
      }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  fun act(label: String, block: suspend () -> Unit) {
    if (busy) return
    busy = true
    note = ""
    scope.launch {
      note = try {
        withContext(Dispatchers.IO) { block() }
        onChanged()
        label
      } catch (e: Exception) {
        e.message ?: "نشد"
      } finally {
        busy = false
      }
      reload++
    }
  }

  Column(Modifier.fillMaxSize()) {
    TopAppBar(
      title = {
        Text(
          data?.optJSONObject("account")?.optString("name").orEmpty().ifBlank { fallbackName },
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      },
      navigationIcon = {
        IconButton(onClick = onBack) {
          Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "بازگشت")
        }
      },
      colors = TopAppBarDefaults.topAppBarColors(
        containerColor = MaterialTheme.colorScheme.background,
      ),
    )

    when {
      data == null && error.isNotBlank() -> ErrorState(error) { reload++ }
      data == null -> Loading()
      else -> {
        val info = data!!
        val account = info.optJSONObject("account") ?: JSONObject()
        val ent = info.optJSONObject("entitlement") ?: JSONObject()
        val subs = readSubs(info.optJSONArray("subscriptions") ?: JSONArray())
        val devices = info.optJSONArray("devices") ?: JSONArray()

        LazyColumn(
          Modifier.fillMaxSize(),
          contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 28.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          item { SubscriptionCard(ent, subs.firstOrNull { it.status == "active" }) }

          item {
            PanelCard {
              CardHeader("مشخصات")
              KeyValue("ایمیل", account.optString("email"))
              KeyValue("شماره", account.optString("phone"))
              KeyValue("شناسه", account.optString("accountId"))
              KeyValue("ساخته شده", dateOf(account.optLong("createdAt")))
              KeyValue(
                "آخرین ورود",
                account.optLong("lastLoginAt").let { if (it > 0) Ago.of(it) else "هنوز وارد نشده" },
              )
              if (account.optString("note").isNotBlank()) {
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = StatusColor.border)
                Text(account.optString("note"), style = MaterialTheme.typography.bodySmall)
              }
            }
          }

          item {
            PlansCard(
              plans = plans,
              busy = busy,
              onGrant = { plan ->
                act("اشتراک داده شد") {
                  Api.grantSubscription(
                    session, accountId, plan.code, plan.amount, plan.unit, plan.title,
                  )
                }
              },
            )
          }

          if (subs.isNotEmpty()) {
            item {
              PanelCard {
                CardHeader("تاریخچهٔ اشتراک", "${subs.size} مورد")
                subs.forEach { sub ->
                  HorizontalDivider(Modifier.padding(vertical = 9.dp), color = StatusColor.border)
                  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                      Text(sub.title, style = MaterialTheme.typography.bodyMedium)
                      Text(
                        "${dateOf(sub.startsAt)}  تا  ${dateOf(sub.endsAt)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                      )
                    }
                    val good = sub.status == "active"
                    Chip(
                      statusTitle(sub.status),
                      if (good) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
                      if (good) StatusColor.goodTint else StatusColor.tint,
                    )
                  }
                  if (sub.status == "active") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                      TextButton(
                        enabled = !busy,
                        onClick = {
                          act("یک ماه تمدید شد") {
                            Api.extendSubscription(session, sub.id.toString(), 1, "month")
                          }
                        },
                      ) { Text("+۱ ماه") }
                      TextButton(
                        enabled = !busy,
                        onClick = {
                          act("اشتراک لغو شد") {
                            Api.setSubscriptionStatus(session, sub.id.toString(), "cancelled")
                          }
                        },
                      ) { Text("لغو", color = StatusColor.bad) }
                    }
                  }
                }
              }
            }
          }

          if (devices.length() > 0) {
            item {
              PanelCard {
                CardHeader("دستگاه‌ها", "${devices.length()} دستگاه وارد شده")
                for (index in 0 until devices.length()) {
                  val device = devices.optJSONObject(index) ?: JSONObject()
                  Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                  ) {
                    RoundIcon(Icons.Filled.Devices)
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                      Text(
                        device.optString("name").ifBlank { device.optString("uid").take(12) },
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                      )
                      Text(
                        device.optLong("lastSeenAt").let { if (it > 0) Ago.of(it) else "—" },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                      )
                    }
                    if (device.optBoolean("revoked")) {
                      Chip("باطل", StatusColor.bad, StatusColor.badTint)
                    }
                  }
                }
              }
            }
          }

          item {
            PanelCard {
              CardHeader(
                "بستنِ حساب",
                "حسابِ بسته همان لحظه از همهٔ دستگاه‌ها بیرون می‌افتد.",
              )
              val disabled = account.optBoolean("disabled")
              Row(
                Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = Arrangement.End,
              ) {
                OutlinedButton(
                  enabled = !busy,
                  onClick = {
                    act(if (disabled) "حساب باز شد" else "حساب بسته شد") {
                      Api.setShopAccountDisabled(session, accountId, !disabled)
                    }
                  },
                ) {
                  Text(
                    if (disabled) "باز کردنِ حساب" else "بستنِ حساب",
                    color = if (disabled) StatusColor.good else StatusColor.bad,
                  )
                }
              }
            }
          }

          if (note.isNotBlank()) {
            item {
              Text(
                note,
                Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
        }
      }
    }
  }
}

/**
 *  کارتِ بالا — همان چیزی که خواسته شده بود: «چقدر مانده».
 *
 *  ⚠️ عدد درشت و نوار، نه یک سطرِ متن. کسی که این صفحه را باز می‌کند
 *  معمولاً دقیقاً همین یک چیز را می‌خواهد بداند و نباید دنبالش بگردد.
 */
@Composable
private fun SubscriptionCard(ent: JSONObject, active: SubRow?) {
  val paid = ent.optBoolean("isPaid")
  val status = ent.optString("status")
  val days = ent.optInt("daysLeft", 0)
  val title = ent.optString("planTitle").ifBlank { ent.optString("plan") }

  val tone: Color = when {
    status == "disabled" -> StatusColor.bad
    !paid -> MaterialTheme.colorScheme.onSurfaceVariant
    days <= 3 -> StatusColor.bad
    days <= 10 -> StatusColor.warn
    else -> StatusColor.good
  }
  val tint = when {
    status == "disabled" -> StatusColor.badTint
    !paid -> StatusColor.tint
    days <= 3 -> StatusColor.badTint
    days <= 10 -> StatusColor.warnTint
    else -> StatusColor.goodTint
  }

  PanelCard {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      RoundIcon(Icons.Filled.WorkspacePremium, tone, tint)
      Column(Modifier.weight(1f).padding(start = 10.dp)) {
        Text(
          when {
            status == "disabled" -> "حساب بسته است"
            paid -> title.ifBlank { "اشتراکی" }
            else -> "بدونِ اشتراک"
          },
          style = MaterialTheme.typography.titleMedium,
        )
        Text(
          ent.optString("message").ifBlank {
            if (paid) "اشتراک فعال است" else "این حساب روی نسخهٔ رایگان است"
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (paid) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text(days.toString(), style = MaterialTheme.typography.headlineMedium, color = tone)
          Text(
            "روز مانده",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }

    if (paid && active != null) {
      /*
       *  نوار نشان می‌دهد چقدر از خودِ دوره گذشته — نه درصدی از یک عددِ
       *  دلخواه. اشتراکِ یک‌ساله با ۳۰ روزِ باقی‌مانده باید تقریباً پر
       *  دیده شود، و ماهانه با ۳۰ روز، خالی.
       */
      val total = (active.endsAt - active.startsAt).coerceAtLeast(1L).toDouble()
      val gone = (System.currentTimeMillis() - active.startsAt).coerceAtLeast(0L).toDouble()
      Meter("گذشته از دوره", (gone / total * 100.0).coerceIn(0.0, 100.0), caption = "", color = tone)
      HorizontalDivider(Modifier.padding(top = 12.dp), color = StatusColor.border)
      KeyValue("شروع", dateOf(active.startsAt))
      KeyValue("پایان", dateOf(active.endsAt), tone)
      if (ent.optInt("maxDevices") > 0) {
        KeyValue("سقفِ دستگاه", "${ent.optInt("maxDevices")}")
      }
    }
  }
}

/**
 *  پلن‌ها — همان‌هایی که روی سرور تعریف شده‌اند.
 *
 *  ⚠️ سه دکمهٔ ثابتِ «۷ روز / ۱ ماه / ۱ سال» برداشته شد: پلن‌های واقعی در
 *  پنل ساخته می‌شوند و عنوان و قیمت و سقفِ دستگاه دارند. دکمه‌های ثابت
 *  یعنی اشتراکی که در پنل «دستی» ثبت می‌شد و هیچ‌وقت با پلن‌ها جور نبود.
 */
@Composable
private fun PlansCard(plans: List<PlanOption>, busy: Boolean, onGrant: (PlanOption) -> Unit) {
  PanelCard {
    CardHeader(
      "دادنِ اشتراک",
      if (plans.isEmpty()) "پلنی روی سرور تعریف نشده — از پنل بسازید"
      else "پلن را بزنید تا همین حالا روی این حساب بنشیند",
    )

    if (plans.isEmpty()) {
      Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledTonalButton(
          enabled = !busy,
          onClick = { onGrant(PlanOption("custom", "یک ماه", 1, "month", 0.0, "")) },
          modifier = Modifier.weight(1f),
        ) { Text("۱ ماه") }
        FilledTonalButton(
          enabled = !busy,
          onClick = { onGrant(PlanOption("custom", "یک سال", 1, "year", 0.0, "")) },
          modifier = Modifier.weight(1f),
        ) { Text("۱ سال") }
      }
      return@PanelCard
    }

    plans.forEach { plan ->
      HorizontalDivider(Modifier.padding(vertical = 9.dp), color = StatusColor.border)
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(plan.title, style = MaterialTheme.typography.bodyLarge)
            if (plan.badge.isNotBlank()) {
              Row(Modifier.padding(start = 6.dp)) {
                Chip(plan.badge, MaterialTheme.colorScheme.primary)
              }
            }
          }
          Text(
            spanOf(plan.amount, plan.unit) +
              if (plan.price > 0) "  ·  ${plan.price.toLong()}" else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        Button(enabled = !busy, onClick = { onGrant(plan) }) { Text("بده") }
      }
    }
  }
}

/* ------------------------------ خواندنِ داده ------------------------------ */

private fun readPlans(array: JSONArray): List<PlanOption> =
  (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    if (row.optInt("active", 1) == 0) return@mapNotNull null
    PlanOption(
      code = row.optString("code"),
      title = row.optString("title").ifBlank { row.optString("code") },
      amount = row.optInt("amount", 1),
      unit = row.optString("unit").ifBlank { "month" },
      price = row.optDouble("price", 0.0),
      badge = row.optString("badge"),
    )
  }

private fun readSubs(array: JSONArray): List<SubRow> =
  (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    SubRow(
      id = row.optInt("id"),
      title = row.optString("plan_title").ifBlank { row.optString("plan_code").ifBlank { "اشتراک" } },
      status = row.optString("status"),
      startsAt = row.optLong("starts_at"),
      endsAt = row.optLong("ends_at"),
    )
  }
