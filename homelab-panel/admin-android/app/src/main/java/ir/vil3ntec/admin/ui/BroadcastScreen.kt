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
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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

/*
 *  ───────────────── پخش — پیام و تخفیف، برای همهٔ برنامه‌ها ─────────────────
 *
 *  ⚠️ دو کار که از یک جنس‌اند: هر دو چیزی را روی صفحهٔ *بقیه* می‌گذارند.
 *  یکی متن، یکی قیمت. به همین دلیل کنارِ هم نشسته‌اند و نه در دو گوشهٔ
 *  متفاوتِ برنامه.
 *
 *  ⚠️ و هیچ‌کدام پوشِ لحظه‌ای نیست: روی صفحه می‌مانند تا خودتان برشان
 *  دارید یا مهلتشان تمام شود. کسی که فردا برنامه را باز می‌کند هم باید
 *  «تخفیفِ این هفته» را ببیند.
 */

private data class Audience(val key: String, val title: String)

private val AUDIENCES = listOf(
  Audience("all", "همه"),
  Audience("shop", "فروشگاه"),
  Audience("station", "پمپ"),
  Audience("site", "سایت‌ها"),
)

private data class Kind(val key: String, val title: String)

private val KINDS = listOf(
  Kind("info", "خبر"),
  Kind("success", "خوب"),
  Kind("warn", "هشدار"),
  Kind("danger", "مهم"),
)

private data class Notice(
  val id: Int,
  val title: String,
  val body: String,
  val kind: String,
  val audience: String,
  val audienceLabel: String,
  val targetId: String,
  val enabled: Boolean,
  val live: Boolean,
  val seen: Int,
  val createdAt: Long,
)

private data class PlanRow(
  val code: String,
  val title: String,
  val price: Double,
  val fullPrice: Double,
  val percent: Int,
  val label: String,
  val discounted: Boolean,
)

private const val DAY_MS = 86_400_000L

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BroadcastScreen(session: Session) {
  var tab by remember { mutableIntStateOf(0) }

  Column(Modifier.fillMaxSize()) {
    Text(
      "پخش",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp),
      style = MaterialTheme.typography.headlineSmall,
    )
    Text(
      "پیام و تخفیفی که روی صفحهٔ برنامه‌های دیگر دیده می‌شود.",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    TabRow(
      selectedTabIndex = tab,
      containerColor = MaterialTheme.colorScheme.background,
      divider = {},
    ) {
      Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("اطلاعیه‌ها") })
      Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("تخفیف‌ها") })
    }

    if (tab == 0) AnnouncementsTab(session) else DiscountsTab(session)
  }
}

/* ========================================================================= */
/*  اطلاعیه‌ها                                                                */
/* ========================================================================= */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AnnouncementsTab(session: Session) {
  var notices by remember { mutableStateOf<List<Notice>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }

  var title by remember { mutableStateOf("") }
  var body by remember { mutableStateOf("") }
  var audience by remember { mutableStateOf(AUDIENCES.first()) }
  var kind by remember { mutableStateOf(KINDS.first()) }
  var days by remember { mutableStateOf("7") }

  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    try {
      notices = withContext(Dispatchers.IO) { readNotices(Api.announcements(session).items("items")) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  fun send() {
    if (busy || title.isBlank()) return
    busy = true
    note = ""
    scope.launch {
      note = try {
        val until = days.trim().toLongOrNull()?.takeIf { it > 0 }
          ?.let { System.currentTimeMillis() + it * DAY_MS }
        withContext(Dispatchers.IO) {
          Api.postAnnouncement(session, audience.key, title.trim(), body.trim(), kind.key, until)
        }
        title = ""
        body = ""
        "فرستاده شد — از همین حالا روی صفحهٔ ${audience.title} دیده می‌شود."
      } catch (e: Exception) {
        e.message ?: "نشد"
      } finally {
        busy = false
      }
      reload++
    }
  }

  fun act(block: suspend () -> Unit) {
    if (busy) return
    busy = true
    scope.launch {
      runCatching { withContext(Dispatchers.IO) { block() } }
        .onFailure { note = it.message ?: "نشد" }
      busy = false
      reload++
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      PanelCard {
        CardHeader(
          "پیامِ تازه",
          "روی صفحهٔ برنامه‌ای که انتخاب می‌کنید می‌نشیند.",
        ) { RoundIcon(Icons.Filled.Campaign) }

        OutlinedTextField(
          value = title,
          onValueChange = { title = it },
          label = { Text("عنوان") },
          placeholder = { Text("مثلاً: تخفیفِ این هفته") },
          singleLine = true,
          shape = MaterialTheme.shapes.small,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
          modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )
        OutlinedTextField(
          value = body,
          onValueChange = { body = it },
          label = { Text("متن (اختیاری)") },
          minLines = 2,
          maxLines = 5,
          shape = MaterialTheme.shapes.small,
          modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )

        SectionTitle("برای کی؟")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
          AUDIENCES.forEachIndexed { index, item ->
            SegmentedButton(
              selected = audience == item,
              onClick = { audience = item },
              shape = SegmentedButtonDefaults.itemShape(index, AUDIENCES.size),
            ) { Text(item.title) }
          }
        }

        SectionTitle("چه جور پیامی؟")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
          KINDS.forEachIndexed { index, item ->
            SegmentedButton(
              selected = kind == item,
              onClick = { kind = item },
              shape = SegmentedButtonDefaults.itemShape(index, KINDS.size),
            ) { Text(item.title) }
          }
        }

        OutlinedTextField(
          value = days,
          onValueChange = { days = it.filter(Char::isDigit).take(3) },
          label = { Text("چند روز بماند؟") },
          supportingText = { Text("خالی بگذارید تا خودتان برش دارید") },
          singleLine = true,
          shape = MaterialTheme.shapes.small,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
          modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )

        if (note.isNotBlank()) {
          Text(
            note,
            Modifier.padding(top = 10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }

        Row(
          Modifier.fillMaxWidth().padding(top = 12.dp),
          horizontalArrangement = Arrangement.End,
        ) {
          Button(enabled = !busy && title.isNotBlank(), onClick = { send() }) {
            Text("بفرست")
          }
        }
      }
    }

    when {
      notices == null && error.isNotBlank() -> item { PanelCard { Text(error) } }
      notices == null -> item { PanelCard { Text("در حال گرفتن…") } }
      notices!!.isEmpty() -> item {
        PanelCard {
          Text(
            "هنوز اطلاعیه‌ای نگذاشته‌اید.",
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
      else -> {
        item { SectionTitle("اطلاعیه‌های شما") }
        items(notices!!, key = { it.id }) { notice ->
          NoticeCard(
            notice = notice,
            busy = busy,
            onToggle = { act { Api.setAnnouncementEnabled(session, notice.id, !notice.enabled) } },
            onDelete = { act { Api.deleteAnnouncement(session, notice.id) } },
          )
        }
      }
    }
  }
}

@Composable
private fun NoticeCard(
  notice: Notice,
  busy: Boolean,
  onToggle: () -> Unit,
  onDelete: () -> Unit,
) {
  PanelCard {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(
          notice.title,
          style = MaterialTheme.typography.bodyLarge,
          maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (notice.body.isNotBlank()) {
          Text(
            notice.body,
            Modifier.padding(top = 2.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
          )
        }
      }
      Switch(checked = notice.enabled, enabled = !busy, onCheckedChange = { onToggle() })
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Chip(notice.audienceLabel, MaterialTheme.colorScheme.primary, StatusColor.tint)
      Chip(kindTitle(notice.kind), kindColor(notice.kind), kindTint(notice.kind))
      if (notice.live) Chip("روی صفحه", StatusColor.good, StatusColor.goodTint)
      else Chip("خاموش", MaterialTheme.colorScheme.onSurfaceVariant, StatusColor.tint)
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 8.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        Ago.of(notice.createdAt),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      TextButton(enabled = !busy, onClick = onDelete) {
        Text("پاک کن", color = StatusColor.bad)
      }
    }
  }
}

@Composable
private fun kindColor(kind: String): Color = when (kind) {
  "success" -> StatusColor.good
  "warn" -> StatusColor.warn
  "danger" -> StatusColor.bad
  else -> MaterialTheme.colorScheme.primary
}

@Composable
private fun kindTint(kind: String): Color = when (kind) {
  "success" -> StatusColor.goodTint
  "warn" -> StatusColor.warnTint
  "danger" -> StatusColor.badTint
  else -> StatusColor.tint
}

private fun kindTitle(kind: String): String =
  KINDS.firstOrNull { it.key == kind }?.title ?: kind

/* ========================================================================= */
/*  تخفیف‌ها                                                                  */
/* ========================================================================= */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiscountsTab(session: Session) {
  var plans by remember { mutableStateOf<List<PlanRow>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf("") }
  var editing by remember { mutableStateOf<PlanRow?>(null) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(reload) {
    error = ""
    try {
      plans = withContext(Dispatchers.IO) { readPlanRows(Api.adminPlans(session).items("plans")) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  fun act(label: String, block: suspend () -> Unit) {
    if (busy) return
    busy = true
    scope.launch {
      note = try {
        withContext(Dispatchers.IO) { block() }
        label
      } catch (e: Exception) {
        e.message ?: "نشد"
      } finally {
        busy = false
      }
      editing = null
      reload++
    }
  }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      PanelCard {
        CardHeader(
          "تخفیف روی قیمت‌ها",
          "قیمتِ اصلی دست نمی‌خورد؛ تخفیف کنارش می‌نشیند و مهلتش که تمام شد، خودش برمی‌گردد.",
        ) { RoundIcon(Icons.Filled.LocalOffer) }
        if (note.isNotBlank()) {
          Text(
            note,
            Modifier.padding(top = 10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }

    when {
      plans == null && error.isNotBlank() -> item { PanelCard { Text(error) } }
      plans == null -> item { PanelCard { Text("در حال گرفتن…") } }
      plans!!.isEmpty() -> item {
        PanelCard {
          Text(
            "نرخی روی سرور تعریف نشده — از پنل، بخشِ نرخ‌ها بسازید.",
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
      else -> items(plans!!, key = { it.code }) { plan ->
        PlanDiscountCard(
          plan = plan,
          busy = busy,
          open = editing?.code == plan.code,
          onOpen = { editing = if (editing?.code == plan.code) null else plan },
          onApply = { percent, label, days ->
            val until = days?.takeIf { it > 0 }?.let { System.currentTimeMillis() + it * DAY_MS }
            act("تخفیفِ ${plan.title} گذاشته شد — همهٔ کاربران همین حالا می‌بینند.") {
              Api.setDiscount(session, plan.code, percent, label, until)
            }
          },
          onClear = {
            act("تخفیفِ ${plan.title} برداشته شد.") { Api.clearDiscount(session, plan.code) }
          },
        )
      }
    }
  }
}

@Composable
private fun PlanDiscountCard(
  plan: PlanRow,
  busy: Boolean,
  open: Boolean,
  onOpen: () -> Unit,
  onApply: (Int, String, Long?) -> Unit,
  onClear: () -> Unit,
) {
  var percent by remember(plan.code) { mutableStateOf(if (plan.percent > 0) plan.percent.toString() else "20") }
  var label by remember(plan.code) { mutableStateOf(plan.label) }
  var days by remember(plan.code) { mutableStateOf("7") }

  PanelCard {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(plan.title, style = MaterialTheme.typography.bodyLarge)
        Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(
            money(plan.price),
            style = MaterialTheme.typography.bodyMedium,
            color = if (plan.discounted) StatusColor.good else MaterialTheme.colorScheme.onSurface,
          )
          if (plan.discounted && plan.fullPrice > plan.price) {
            Text(
              "  ${money(plan.fullPrice)}",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
      if (plan.discounted) Chip("٪${plan.percent}-", StatusColor.good, StatusColor.goodTint)
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 8.dp),
      horizontalArrangement = Arrangement.End,
    ) {
      if (plan.discounted) {
        TextButton(enabled = !busy, onClick = onClear) {
          Text("برداشتن", color = StatusColor.bad)
        }
      }
      OutlinedButton(
        enabled = !busy,
        onClick = onOpen,
        modifier = Modifier.padding(start = 8.dp),
      ) { Text(if (open) "بستن" else if (plan.discounted) "تغییر" else "تخفیف بگذار") }
    }

    if (open) {
      HorizontalDivider(Modifier.padding(vertical = 10.dp), color = StatusColor.border)
      OutlinedTextField(
        value = percent,
        onValueChange = { percent = it.filter(Char::isDigit).take(2) },
        label = { Text("چند درصد؟") },
        singleLine = true,
        shape = MaterialTheme.shapes.small,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        value = label,
        onValueChange = { label = it },
        label = { Text("برچسب (اختیاری)") },
        placeholder = { Text("مثلاً: جشنوارهٔ نوروز") },
        singleLine = true,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
      )
      OutlinedTextField(
        value = days,
        onValueChange = { days = it.filter(Char::isDigit).take(3) },
        label = { Text("چند روز؟") },
        supportingText = { Text("خالی یعنی تا وقتی خودتان برش دارید") },
        singleLine = true,
        shape = MaterialTheme.shapes.small,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
      )
      Row(
        Modifier.fillMaxWidth().padding(top = 12.dp),
        horizontalArrangement = Arrangement.End,
      ) {
        Button(
          enabled = !busy && (percent.toIntOrNull() ?: 0) in 1..99,
          onClick = { onApply(percent.toIntOrNull() ?: 0, label.trim(), days.trim().toLongOrNull()) },
        ) { Text("اعمال کن") }
      }
    }
  }
}

/** عددِ قیمت با جداکنندهٔ هزارگان — بی واحد، چون واحد را خودِ سرور می‌داند */
private fun money(value: Double): String {
  val n = value.toLong()
  if (n <= 0) return "رایگان"
  return n.toString().reversed().chunked(3).joinToString(",").reversed()
}

/* ------------------------------ خواندنِ داده ------------------------------ */

private fun readNotices(array: JSONArray): List<Notice> =
  (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    Notice(
      id = row.optInt("id"),
      title = row.optString("title"),
      body = row.optString("body"),
      kind = row.optString("kind").ifBlank { "info" },
      audience = row.optString("audience"),
      audienceLabel = row.optString("audienceLabel").ifBlank { row.optString("audience") },
      targetId = row.optString("targetId"),
      enabled = row.optBoolean("enabled"),
      live = row.optBoolean("live"),
      seen = row.optInt("seen"),
      createdAt = row.optLong("createdAt"),
    )
  }

private fun readPlanRows(array: JSONArray): List<PlanRow> =
  (0 until array.length()).mapNotNull { index ->
    val row = array.optJSONObject(index) ?: return@mapNotNull null
    val discount: JSONObject? = row.optJSONObject("discount")
    PlanRow(
      code = row.optString("code"),
      title = row.optString("title").ifBlank { row.optString("code") },
      price = row.optDouble("price", 0.0),
      fullPrice = row.optDouble("fullPrice", row.optDouble("price", 0.0)),
      percent = discount?.optInt("percent") ?: 0,
      label = discount?.optString("label").orEmpty(),
      discounted = discount != null,
    )
  }
