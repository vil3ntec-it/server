package ir.vil3ntec.admin.ui

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.LocalGasStation
import androidx.compose.material.icons.filled.Pin
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Ago
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.ApiError
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/*
 *  ──────────────────────────── بخشِ پمپ بنزین ────────────────────────────
 *
 *  پنج زیربخش، چون پنج سؤالِ متفاوت‌اند:
 *
 *    حساب‌ها     کی حساب دارد، فعال است یا نه، چه اشتراکی دارد
 *    وصل بودن    کی همین حالا آنلاین است و پشتیبان گرفته یا نه
 *    نرخ‌ها      قیمت‌ها و تخفیف‌ها
 *    کد و ربات   کدهای شش‌رقمیِ همین بخش، و فرستادنشان
 *    داده‌ها      چه چیزی خراب است و آینهٔ سرورِ حساب کِی گرفته شده
 *
 *  ⚠️ نکته‌ای که کلِ این صفحه را شکل داد: حساب‌ها و اشتراک‌ها و نرخ‌های
 *  پمپ روی *سرورِ حساب* هستند (shop/server، همان که تا دیروز «ابر» می‌گفتیم و
 *  روی همان کامپیوترِ خانگی است)، نه در دفترِ خودِ پنل. پنل فقط هر نیم‌ساعت
 *  آینه‌شان می‌کند و درخواست‌ها را رد می‌کند آن‌طرف.
 *
 *  یعنی تا وقتی پنل به سرورِ حساب وارد نشده، این سه زیربخش خالی‌اند — و
 *  باید *بگویند* چرا، نه اینکه فهرستِ خالی نشان بدهند. «چیزی نیست» و
 *  «وصل نیستم» دو چیزِ کاملاً متفاوت‌اند. و «وصل نیستم» هم سه شکل دارد که
 *  ‎CloudProblem‎ جدا می‌گوید: سرور خاموش است، مدیر وارد نشده (فرمِ ورود همین‌جا)،
 *  یا نشستش تمام شده.
 *
 *  ⚠️ واژه‌ها: «پشتیبان» یعنی فایلِ بک‌آپ، نه «پشتیبانی». یک بار «هیچ پشتیبانی
 *  ندارد» نوشته شد و صاحبِ سامانه خواند «برنامهٔ پمپ پشتیبانی نمی‌شود».
 */

private val PUMP_TABS = listOf(
  "حساب‌ها و کاربرها",
  //  ⛔ اشتراک‌های پمپ همین‌جا — روزِ مانده، پایان، دادن/تمدید/تعلیق/لغو
  "💳 اشتراک‌ها",
  "وصل بودن",
  "نرخ‌ها",
  "کد و ربات",
  "داده‌ها",
)

/** شناسهٔ برنامه در بخشِ کدهای شش‌رقمی — تا کدهای پمپ از بقیه جدا بمانند */
private const val PUMP_CODE_APP = "pump-station"
private const val PUMP_CODE_NAME = "پمپ بنزین"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StationsScreen(session: Session) {
  var tab by remember { mutableIntStateOf(0) }
  //  «مدیریتِ اشتراک» از کارتِ یک حساب ⇒ همین زبانه با ایمیلِ همان حساب
  var subsQuery by remember { mutableStateOf("") }

  Column(Modifier.fillMaxSize()) {
    Text(
      "پمپ بنزین",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp),
      style = MaterialTheme.typography.headlineSmall,
    )

    ScrollableTabRow(
      selectedTabIndex = tab,
      edgePadding = 12.dp,
      containerColor = MaterialTheme.colorScheme.background,
      divider = {},
    ) {
      PUMP_TABS.forEachIndexed { index, title ->
        Tab(
          selected = tab == index,
          onClick = { tab = index },
          text = { Text(title, style = MaterialTheme.typography.labelLarge) },
        )
      }
    }

    when (tab) {
      0 -> PumpAccountsTab(session, onManage = { q -> subsQuery = q; tab = 1 })
      1 -> SubscriptionsTab(session, "pump", initialQuery = subsQuery)
      2 -> PumpOnlineTab(session)
      3 -> PumpPlansTab(session)
      4 -> PumpCodesTab(session)
      5 -> PumpDataTab(session)
    }
  }
}

/* ========================================================================= */
/*  ۱ — حساب‌ها و کاربرها                                                     */
/* ========================================================================= */

private data class PumpUser(
  val id: String,
  val name: String,
  val contact: String,
  val active: Boolean,
  val plan: String,
  val daysLeft: Int,
  val hasBackup: Boolean,
)

@Composable
private fun PumpAccountsTab(session: Session, onManage: (String) -> Unit) {
  var users by remember { mutableStateOf<List<PumpUser>?>(null) }
  var error by remember { mutableStateOf("") }
  var errorCode by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    errorCode = ""
    try {
      users = withContext(Dispatchers.IO) { readPumpUsers(Api.pumpUsers(session)) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
      errorCode = (e as? ApiError)?.code.orEmpty()
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    if (note.isNotBlank()) {
      item { PanelCard { Text(note, style = MaterialTheme.typography.bodySmall) } }
    }

    when {
      users == null && error.isNotBlank() -> item { CloudProblem(session, errorCode, error) { reload++ } }
      users == null -> item { PanelCard { Text("در حال گرفتن…") } }
      users!!.isEmpty() -> item {
        PanelCard {
          CardHeader("حسابی نیست", "هنوز کسی روی سرورِ حساب حسابِ پمپ نساخته است.")
        }
      }
      else -> {
        item {
          SectionTitle("${users!!.size} حساب · ${users!!.count { it.active }} فعال")
        }
        items(safeKeys(users!!) { it.id }, key = { it.first }) { (_, user) ->
          PumpUserCard(user, busy = busy, onGrant = {
            onManage(user.contact.substringBefore(" · ").ifBlank { user.name })
          })
        }
      }
    }
  }

  //  ⛔ «اشتراک بده»ِ قدیمی این‌جا شناسهٔ **کاربر** را به‌جای شناسهٔ پمپ
  //  می‌فرستاد، با `planCode`/`months` که سرورِ حساب نمی‌خواند — یعنی هیچ‌وقت
  //  درست اشتراک نمی‌داد. حالا کارت به زبانهٔ «اشتراک‌ها» می‌رود، با ایمیلِ
  //  همین حساب از پیش نوشته‌شده؛ تنها جای دادن و برداشتن همان‌جاست.
}

@Composable
private fun PumpUserCard(user: PumpUser, busy: Boolean, onGrant: () -> Unit) {
  val tone: Color = when {
    !user.active -> StatusColor.bad
    user.daysLeft in 1..10 -> StatusColor.warn
    user.plan.isNotBlank() -> StatusColor.good
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }
  val tint = when {
    !user.active -> StatusColor.badTint
    user.daysLeft in 1..10 -> StatusColor.warnTint
    user.plan.isNotBlank() -> StatusColor.goodTint
    else -> StatusColor.tint
  }

  PanelCard {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Avatar(user.name, tone, tint)
      Column(Modifier.weight(1f).padding(start = 12.dp)) {
        Text(
          user.name.ifBlank { "بی‌نام" },
          style = MaterialTheme.typography.bodyLarge,
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
          user.contact.ifBlank { user.id },
          Modifier.padding(top = 2.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
      }
      Chip(if (user.active) "فعال" else "غیرفعال", tone, tint)
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Chip(
        user.plan.ifBlank { "بدونِ اشتراک" },
        if (user.plan.isNotBlank()) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurfaceVariant,
        StatusColor.tint,
      )
      if (user.daysLeft > 0) Chip("${user.daysLeft} روز", tone, tint)
      Chip(
        if (user.hasBackup) "بک‌آپ دارد" else "بک‌آپ ندارد",
        if (user.hasBackup) StatusColor.good else StatusColor.warn,
        if (user.hasBackup) StatusColor.goodTint else StatusColor.warnTint,
      )
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 8.dp),
      horizontalArrangement = Arrangement.End,
    ) {
      OutlinedButton(enabled = !busy, onClick = onGrant) { Text("مدیریتِ اشتراک") }
    }
  }
}

/* ========================================================================= */
/*  ۲ — وصل بودن                                                             */
/* ========================================================================= */

private data class LiveStation(
  val code: String,
  val name: String,
  val online: Boolean,
  val lastSeenAt: Long,
  val connections: Int,
)

@Composable
private fun PumpOnlineTab(session: Session) {
  var rows by remember { mutableStateOf<List<LiveStation>?>(null) }
  var backups by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }

  LaunchedEffect(reload) {
    error = ""
    try {
      val list = withContext(Dispatchers.IO) { readStations(Api.stations(session).items("stations")) }
      rows = list
      /*
       *  ⚠️ پشتیبان‌ها برای هر پمپ جدا گرفته می‌شود و اگر یکی نشد، بقیه
       *  باید بیایند. یک پمپِ خراب نباید کلِ صفحه را خالی کند.
       */
      val found = mutableMapOf<String, Int>()
      for (station in list.take(30)) {
        runCatching {
          withContext(Dispatchers.IO) {
            Api.stationDetail(session, station.code).o().optJSONArray("backups")?.length() ?: 0
          }
        }.onSuccess { found[station.code] = it }
      }
      backups = found
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    when {
      rows == null && error.isNotBlank() -> item { PanelCard { Text(error) } }
      rows == null -> item { PanelCard { Text("در حال گرفتن…") } }
      rows!!.isEmpty() -> item {
        PanelCard { CardHeader("پمپی وصل نشده", "هنوز هیچ پمپی روی این سرور ثبت نشده است.") }
      }
      else -> {
        item {
          val on = rows!!.count { it.online }
          PanelCard {
            CardHeader("همین حالا", "$on از ${rows!!.size} پمپ آنلاین است.") {
              RoundIcon(
                Icons.Filled.LocalGasStation,
                if (on > 0) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
                if (on > 0) StatusColor.goodTint else StatusColor.tint,
              )
            }
          }
        }
        items(safeKeys(rows!!) { it.code }, key = { it.first }) { (_, station) ->
          val count = backups[station.code]
          PanelCard {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
              PulseDot(
                if (station.online) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
                alive = station.online,
              )
              Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(
                  station.name.ifBlank { station.code },
                  style = MaterialTheme.typography.bodyLarge,
                  maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                  if (station.lastSeenAt > 0) "آخرین تپش ${Ago.of(station.lastSeenAt)}"
                  else "هنوز تپشی نفرستاده",
                  Modifier.padding(top = 2.dp),
                  style = MaterialTheme.typography.labelSmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
              Chip(
                if (station.online) "آنلاین" else "آفلاین",
                if (station.online) StatusColor.good else MaterialTheme.colorScheme.onSurfaceVariant,
                if (station.online) StatusColor.goodTint else StatusColor.tint,
              )
            }
            Row(
              Modifier.fillMaxWidth().padding(top = 10.dp),
              horizontalArrangement = Arrangement.spacedBy(6.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              RoundIcon(
                Icons.Filled.Backup,
                if ((count ?: 0) > 0) StatusColor.good else StatusColor.warn,
                if ((count ?: 0) > 0) StatusColor.goodTint else StatusColor.warnTint,
              )
              Text(
                when {
                  count == null -> "فایل‌های بک‌آپ خوانده نشد"
                  count > 0 -> "$count فایلِ بک‌آپ روی این سرور دارد"
                  else -> "هنوز فایلِ بک‌آپی نفرستاده — برنامه هر ۶ ساعت می‌فرستد"
                },
                Modifier.padding(start = 10.dp),
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

/* ========================================================================= */
/*  ۳ — نرخ‌ها                                                                */
/* ========================================================================= */

@Composable
private fun PumpPlansTab(session: Session) {
  var plans by remember { mutableStateOf<JSONArray?>(null) }
  var currency by remember { mutableStateOf("") }
  var error by remember { mutableStateOf("") }
  var errorCode by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }

  LaunchedEffect(reload) {
    error = ""
    errorCode = ""
    try {
      val reply = withContext(Dispatchers.IO) { Api.pumpPlans(session) }
      plans = reply.items("plans")
      currency = reply.o().optJSONObject("config")?.optString("currency").orEmpty()
        .ifBlank { reply.o().optString("currency") }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
      errorCode = (e as? ApiError)?.code.orEmpty()
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    when {
      plans == null && error.isNotBlank() -> item { CloudProblem(session, errorCode, error) { reload++ } }
      plans == null -> item { PanelCard { Text("در حال گرفتن…") } }
      plans!!.length() == 0 -> item {
        PanelCard { CardHeader("نرخی نیست", "روی سرورِ حساب هنوز نرخی تعریف نشده است.") }
      }
      else -> {
        item {
          PanelCard {
            CardHeader(
              "نرخ‌های پمپ",
              if (currency.isNotBlank()) "واحد: $currency" else "نرخ‌هایی که روی سرورِ حساب ثبت شده‌اند.",
            )
            /*
             *  ⚠️ این‌جا عمداً فقط خواندنی است، و دلیلش را می‌گوییم.
             *
             *  نرخِ پمپ روی سرورِ حساب تعریف می‌شود و پنل فقط واسطه است؛
             *  مسیرِ نوشتنِ نرخ در این واسطه باز نیست. نشان دادنِ دکمه‌ای
             *  که کار نمی‌کند، از نبودنش بدتر است.
             */
            Text(
              "تغییرِ قیمت و تخفیفِ پمپ از پنلِ مدیریتِ سرورِ حساب (api.vill3n.top/admin) انجام می‌شود؛ این‌جا فقط دیده می‌شود. " +
                "تخفیفِ اشتراک‌های فروشگاه در تبِ «پخش» است.",
              Modifier.padding(top = 10.dp),
              style = MaterialTheme.typography.bodySmall,
              color = StatusColor.warn,
            )
          }
        }
        val rows = (0 until plans!!.length()).mapNotNull { plans!!.optJSONObject(it) }
        items(safeKeys(rows) { it.optString("code").ifBlank { it.optString("id") } }, key = { it.first }) { (_, plan) ->
          PanelCard {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
              Column(Modifier.weight(1f)) {
                Text(
                  plan.optString("title").ifBlank { plan.optString("name").ifBlank { plan.optString("code") } },
                  style = MaterialTheme.typography.bodyLarge,
                )
                val months = plan.optInt("months", plan.optInt("amount", 0))
                if (months > 0) {
                  Text(
                    "$months ماه",
                    Modifier.padding(top = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }
              }
              val price = plan.optDouble("price", 0.0)
              Text(
                if (price > 0) "${price.toLong()} $currency".trim() else "—",
                style = MaterialTheme.typography.bodyMedium,
              )
            }
          }
        }
      }
    }
  }
}

/* ========================================================================= */
/*  ۴ — کد و ربات                                                             */
/* ========================================================================= */

@Composable
private fun PumpCodesTab(session: Session) {
  var items by remember { mutableStateOf<List<JSONObject>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var email by remember { mutableStateOf("") }
  var who by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  /*
   *  ⚠️ «رفت» و «نرفت» باید از هم جدا دیده شوند.
   *
   *  گزارشِ واقعی: «۵ تا تست زدم، ۲ ایمیل رفت و سه تای دیگر نیامد، در
   *  حالی که می‌گوید فرستادم.» حالا سرور تا نتیجهٔ واقعی را نبیند جواب
   *  نمی‌دهد، و این‌جا هم پیامِ شکست قرمز است نه خاکستری.
   */
  var noteFailed by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    try {
      val array = withContext(Dispatchers.IO) { Api.liveCodes(session, PUMP_CODE_APP).items("items") }
      items = (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  fun send() {
    if (busy || email.isBlank()) return
    busy = true
    note = ""
    noteFailed = false
    scope.launch {
      try {
        val reply = withContext(Dispatchers.IO) {
          Api.sendCode(session, PUMP_CODE_APP, email.trim(), PUMP_CODE_NAME, who.trim())
        }.o()
        val state = reply.optJSONObject("delivery")?.optString("state") ?: ""
        noteFailed = state == "failed" || !reply.optBoolean("ok", true)
        note = reply.optString("message").ifBlank {
          if (noteFailed) "ایمیل نرفت" else "کد ساخته شد و در صفِ ارسال است."
        }
        // ایمیلی که نرفت را پاک نمی‌کنیم؛ شاید فقط یک حرفش غلط بوده
        if (!noteFailed) {
          email = ""
          who = ""
        }
      } catch (e: Exception) {
        noteFailed = true
        note = e.message ?: "نشد"
      } finally {
        busy = false
      }
      reload++
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
          "ربات — کد بفرست",
          "کد ساخته می‌شود و همان لحظه به ایمیلِ طرف می‌رود.",
        ) { RoundIcon(Icons.Filled.Pin) }

        OutlinedTextField(
          value = email,
          onValueChange = { email = it },
          label = { Text("ایمیل") },
          singleLine = true,
          shape = MaterialTheme.shapes.small,
          keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Next,
          ),
          modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )
        OutlinedTextField(
          value = who,
          onValueChange = { who = it },
          label = { Text("شناسهٔ پمپ یا کاربر (اختیاری)") },
          singleLine = true,
          shape = MaterialTheme.shapes.small,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
          modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )

        if (note.isNotBlank()) {
          Text(
            note,
            Modifier.padding(top = 10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = if (noteFailed) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }

        Row(
          Modifier.fillMaxWidth().padding(top = 12.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          Button(enabled = !busy && email.isNotBlank(), onClick = { send() }) {
            Text(if (busy) "در حالِ فرستادن…" else "بفرست")
          }
        }
      }
    }

    item {
      SectionTitle("کدهای همین بخش")
      /*
       *  ⚠️ این‌ها از همان موتورِ «کدهای شش‌رقمی» می‌آیند، فقط با برچسبِ
       *  پمپ. یعنی یک موتور، یک صف، یک قالبِ ایمیل — نه دو تا که با هم
       *  نخوانند.
       */
    }

    when {
      items == null && error.isNotBlank() -> item { PanelCard { Text(error) } }
      items == null -> item { PanelCard { Text("در حال گرفتن…") } }
      items!!.isEmpty() -> item {
        PanelCard {
          Text(
            "هنوز کدی برای پمپ ساخته نشده.",
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
      else -> items(safeKeys(items!!) { it.optString("id") }, key = { it.first }) { (_, row) ->
        PanelCard {
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(
                row.optString("email"),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
              )
              Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val sent = row.optString("sendState")
                Chip(
                  when (sent) {
                    "sent" -> "رفت"
                    "failed" -> "نرفت"
                    "sending" -> "در حالِ رفتن"
                    else -> "در صف"
                  },
                  when (sent) {
                    "sent" -> StatusColor.good
                    "failed" -> StatusColor.bad
                    else -> StatusColor.warn
                  },
                  when (sent) {
                    "sent" -> StatusColor.goodTint
                    "failed" -> StatusColor.badTint
                    else -> StatusColor.warnTint
                  },
                )
                if (row.optString("subjectId").isNotBlank()) {
                  Chip(row.optString("subjectId"), MaterialTheme.colorScheme.primary, StatusColor.tint)
                }
              }
            }
            val code = row.optString("code")
            if (code.isNotBlank()) {
              Text(code, style = MonoDigits, color = MaterialTheme.colorScheme.primary)
            } else {
              Text(
                "تمام شد",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
        }
      }
    }
  }
}

/* ========================================================================= */
/*  ۵ — داده‌ها و عیب‌یابی                                                     */
/* ========================================================================= */

@Composable
private fun PumpDataTab(session: Session) {
  var checks by remember { mutableStateOf<List<JSONObject>?>(null) }
  var summary by remember { mutableStateOf("") }
  var mirror by remember { mutableStateOf<JSONObject?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    try {
      val reply = withContext(Dispatchers.IO) { Api.diagnostics(session) }.o()
      val array = reply.optJSONArray("checks") ?: JSONArray()
      checks = (0 until array.length()).mapNotNull { array.optJSONObject(it) }
      summary = reply.optString("summary")
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
    // آینهٔ سرورِ حساب جداست و نبودنش نباید عیب‌یابی را خالی کند
    runCatching { withContext(Dispatchers.IO) { Api.cloudMirror(session).o() } }
      .onSuccess { mirror = it }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    item {
      PanelCard {
        CardHeader("آیا برنامه‌ها به سرور می‌رسند؟", summary.ifBlank { "در حال سنجیدن…" })
        Row(
          Modifier.fillMaxWidth().padding(top = 10.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          TextButton(onClick = { reload++ }) { Text("دوباره بسنج") }
        }
      }
    }

    when {
      checks == null && error.isNotBlank() -> item { PanelCard { Text(error) } }
      checks == null -> item { PanelCard { Text("در حال گرفتن…") } }
      else -> items(safeKeys(checks!!) { it.optString("key") }, key = { it.first }) { (_, check) ->
        val state = check.optString("state")
        val tone = when (state) {
          "good" -> StatusColor.good
          "warn" -> StatusColor.warn
          else -> StatusColor.bad
        }
        val tint = when (state) {
          "good" -> StatusColor.goodTint
          "warn" -> StatusColor.warnTint
          else -> StatusColor.badTint
        }
        PanelCard {
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            PulseDot(tone, alive = state == "good")
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
              Text(check.optString("title"), style = MaterialTheme.typography.bodyLarge)
              Text(
                check.optString("value"),
                Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.labelSmall,
                color = tone,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
              )
            }
            Chip(
              when (state) {
                "good" -> "خوب"
                "warn" -> "هشدار"
                else -> "خراب"
              },
              tone, tint,
            )
          }
          Text(
            check.optString("hint"),
            Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }

    item {
      PanelCard {
        val last = mirror?.optJSONObject("last")
        CardHeader(
          "آینهٔ سرورِ حساب روی همین سرور",
          "حساب‌های پمپ هر نیم ساعت در پوشهٔ دادهٔ خودتان هم نوشته می‌شوند.",
        )
        HorizontalDivider(Modifier.padding(vertical = 10.dp), color = StatusColor.border)
        KeyValue(
          "آخرین بار",
          last?.optLong("at")?.takeIf { it > 0 }?.let { Ago.of(it) } ?: "هنوز نگرفته",
        )
        KeyValue("پوشه", mirror?.optString("dir").orEmpty())
        if (note.isNotBlank()) {
          Text(
            note,
            Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        Row(
          Modifier.fillMaxWidth().padding(top = 10.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          OutlinedButton(
            enabled = !busy,
            onClick = {
              busy = true
              note = ""
              scope.launch {
                note = try {
                  withContext(Dispatchers.IO) { Api.runCloudMirror(session) }
                  "گرفته شد."
                } catch (e: Exception) {
                  e.message ?: "نشد — پنل به سرورِ حساب وصل است؟"
                } finally {
                  busy = false
                }
                reload++
              }
            },
          ) { Text("همین حالا بگیر") }
        }
      }
    }
  }
}

/* ========================================================================= */
/*  مشترک                                                                     */
/* ========================================================================= */

/**
 *  «وصل نیستم» — و نه «چیزی نیست».
 *
 *  ⚠️ این دو تا را نباید یک شکل نشان داد. فهرستِ خالی یعنی کاری نمانده؛
 *  این یعنی اصلاً نتوانستیم بپرسیم. کسی که فرقشان را نداند، دنبالِ
 *  مشکلِ اشتباه می‌گردد.
 *
 *  ⚠️ و «وصل نیستم» خودش سه حال دارد که پنل با کدِ خطا جدا می‌گوید:
 *    account_server_down / _unreachable   سرورِ حساب روشن نیست ⇒ راهِ روشن کردنش
 *    not_linked · cloud_session_expired   مدیر واردش نشده ⇒ فرمِ ورود همین‌جا
 *    هر چیزِ دیگر                          پیامِ خودِ پنل
 *  تا پیش از این کارت فقط می‌گفت «از پنل ← پمپ‌ها ← ابر واردش کنید» — یعنی
 *  کاری که از خودِ گوشی شدنی نبود.
 */
@Composable
private fun CloudProblem(
  session: Session,
  code: String,
  message: String,
  onRetry: () -> Unit,
) {
  val down = code == "account_server_down" || code == "account_server_unreachable"
  val needsLogin = code == "not_linked" || code == "cloud_session_expired" || code == "auto_login_rejected"
  var user by remember { mutableStateOf("") }
  var pass by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  PanelCard {
    CardHeader(
      when {
        down -> "سرورِ حساب روشن نیست"
        needsLogin -> "به سرورِ حساب وارد نشده‌اید"
        else -> "از سرورِ حساب جواب نگرفتیم"
      },
      "حساب‌ها، اشتراک‌ها و نرخ‌های پمپ روی سرورِ حساب‌اند — همان shop/server روی کامپیوترِ خانگی.",
    ) { RoundIcon(Icons.Filled.CloudOff, StatusColor.warn, StatusColor.warnTint) }
    Text(
      message,
      Modifier.padding(top = 10.dp),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    if (down) {
      Text(
        "روی همان کامپیوتر: cd shop/server && docker compose up -d — بعد «دوباره» را بزنید.",
        Modifier.padding(top = 6.dp),
        style = MaterialTheme.typography.labelSmall,
        color = StatusColor.warn,
      )
    }

    if (needsLogin) {
      Text(
        "نام و رمزِ مدیرِ همان سرور را بزنید. رمز ذخیره نمی‌شود؛ فقط توکنش در گاوصندوقِ پنل می‌نشیند. " +
          "اگر نمی‌خواهید هر دوازده ساعت دوباره وارد شوید، در .envِ پنل HLP_ACCOUNT_ADMIN_USER و " +
          "HLP_ACCOUNT_ADMIN_PASSWORD را بگذارید تا پنل خودش وارد شود.",
        Modifier.padding(top = 8.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      OutlinedTextField(
        value = user,
        onValueChange = { user = it },
        label = { Text("نام کاربریِ مدیرِ سرورِ حساب") },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
      )
      OutlinedTextField(
        value = pass,
        onValueChange = { pass = it },
        label = { Text("رمز") },
        singleLine = true,
        enabled = !busy,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
      )
      if (note.isNotBlank()) {
        Text(
          note,
          Modifier.padding(top = 6.dp),
          style = MaterialTheme.typography.labelSmall,
          color = StatusColor.warn,
        )
      }
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 10.dp),
      horizontalArrangement = Arrangement.End,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TextButton(onClick = onRetry, enabled = !busy) { Text("دوباره") }
      if (needsLogin) {
        Button(
          enabled = !busy && user.isNotBlank() && pass.isNotEmpty(),
          onClick = {
            busy = true
            note = ""
            scope.launch {
              try {
                withContext(Dispatchers.IO) { Api.cloudLogin(session, user.trim(), pass) }
                pass = ""
                onRetry()
              } catch (e: Exception) {
                note = e.message ?: "وصل نشد"
              } finally {
                busy = false
              }
            }
          },
        ) { Text(if (busy) "در حالِ ورود…" else "وصل شدن") }
      }
    }
  }
}

/* ------------------------------ خواندنِ داده ------------------------------ */

/**
 *  ⚠️ نامِ فیلدها با احتیاط خوانده می‌شود و چند نام امتحان می‌شود.
 *
 *  این داده از سرورِ حساب می‌آید و شکلش دستِ ما نیست. همین‌جا بود که یک بار
 *  کلِ برنامه افتاد — وقتی سرور `id` می‌فرستاد و ما `threadId` می‌خواندیم.
 *  حالا هم چند نام امتحان می‌شود و هم کلیدِ فهرست از safeKeys می‌آید، تا
 *  بدترین حالت «بد دیده شدن» باشد نه افتادنِ برنامه.
 */
private fun readPumpUsers(reply: Api.Reply): List<PumpUser> {
  val array = reply.items("users").takeIf { it.length() > 0 } ?: reply.items("items")
  return (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    val sub = row.optJSONObject("subscription")
    PumpUser(
      id = row.optString("id")
        .ifBlank { row.optString("userId") }
        .ifBlank { row.optString("stationId") },
      name = row.optString("name")
        .ifBlank { row.optString("stationName") }
        .ifBlank { row.optString("username") },
      contact = listOf(row.optString("email"), row.optString("phone"))
        .filter { it.isNotBlank() }.joinToString(" · "),
      active = when {
        row.has("active") -> row.optBoolean("active")
        row.has("disabled") -> !row.optBoolean("disabled")
        else -> true
      },
      plan = row.optString("plan")
        .ifBlank { row.optString("planTitle") }
        .ifBlank { sub?.optString("planTitle").orEmpty() },
      daysLeft = when {
        row.has("daysLeft") -> row.optInt("daysLeft")
        sub != null -> sub.optInt("daysLeft")
        else -> 0
      },
      hasBackup = row.optBoolean("hasBackup", row.optInt("backups") > 0),
    )
  }
}

private fun readStations(array: JSONArray): List<LiveStation> =
  (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    LiveStation(
      code = row.optString("code"),
      name = row.optString("name"),
      online = row.optBoolean("online", row.optInt("liveConnections") > 0),
      lastSeenAt = row.optLong("lastSeenAt", row.optLong("lastActivity")),
      connections = row.optInt("liveConnections"),
    )
  }
