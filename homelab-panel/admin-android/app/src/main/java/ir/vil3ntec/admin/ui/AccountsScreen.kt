package ir.vil3ntec.admin.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Ago
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** یک ردیف در فهرستِ حساب‌ها — هر چهار بخش به همین شکل در می‌آیند */
private data class AccountRow(
  val id: String,
  val title: String,
  val subtitle: String,
  val badge: String,
  val badgeTone: Int,
  /** فقط حساب‌های فروشگاه پروندهٔ کامل دارند */
  val openable: Boolean,
)

private const val TONE_NEUTRAL = 0
private const val TONE_GOOD = 1
private const val TONE_WARN = 2
private const val TONE_BAD = 3

private enum class Section(val title: String) {
  Shops("فروشگاه‌ها"),
  Stations("پمپ‌ها"),
  Sites("سایت‌ها"),
  Panel("کاربران پنل"),
}

/**
 *  حساب‌های روی سرور، در چهار بخش.
 *
 *  ⚠️ هر چهار بخش از چهار API جدا می‌آیند و شکلشان هم یکی نیست. به‌جای
 *  چهار صفحهٔ متفاوت، همه به یک ردیفِ مشترک ترجمه می‌شوند — وگرنه همین
 *  صفحه چهار برابر می‌شد و هر تغییری باید چهار بار انجام می‌گرفت.
 */
@Composable
fun AccountsScreen(session: Session) {
  var section by remember { mutableStateOf(Section.Shops) }
  var rows by remember { mutableStateOf<List<AccountRow>?>(null) }
  var error by remember { mutableStateOf("") }
  var reload by remember { mutableIntStateOf(0) }
  var query by remember { mutableStateOf("") }
  var open by remember { mutableStateOf<AccountRow?>(null) }

  LaunchedEffect(section, reload) {
    rows = null
    error = ""
    try {
      rows = withContext(Dispatchers.IO) { load(session, section) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  /*
   *  پروندهٔ یک حساب، روی همین تب.
   *
   *  ⚠️ به‌جای کادرِ شناور: صفحهٔ کامل جا دارد برای اشتراک و تاریخچه و
   *  دستگاه‌ها، و دکمهٔ برگشتِ خودِ گوشی هم همان‌طور که انتظار می‌رود
   *  کار می‌کند.
   */
  open?.let { target ->
    // دکمهٔ برگشتِ خودِ گوشی باید فهرست را برگرداند، نه برنامه را ببندد
    BackHandler { open = null }
    ShopAccountDetail(
      session = session,
      accountId = target.id,
      fallbackName = target.title,
      onBack = { open = null },
      onChanged = { reload++ },
    )
    return
  }

  val visible = rows?.filter { row ->
    query.isBlank() ||
      row.title.contains(query, true) ||
      row.subtitle.contains(query, true) ||
      row.id.contains(query, true)
  }

  Column(Modifier.fillMaxSize()) {
    Text(
      "حساب‌ها",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp),
      style = MaterialTheme.typography.headlineSmall,
    )

    ScrollableTabRow(
      selectedTabIndex = section.ordinal,
      edgePadding = 12.dp,
      containerColor = MaterialTheme.colorScheme.background,
      divider = {},
    ) {
      Section.entries.forEach { item ->
        Tab(
          selected = section == item,
          onClick = { section = item; query = "" },
          text = { Text(item.title, style = MaterialTheme.typography.labelLarge) },
        )
      }
    }

    OutlinedTextField(
      value = query,
      onValueChange = { query = it },
      placeholder = { Text("جست‌وجو در نام، ایمیل، شماره…") },
      leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
      trailingIcon = {
        if (query.isNotBlank()) {
          IconButton(onClick = { query = "" }) {
            Icon(Icons.Filled.Close, contentDescription = "پاک کردن")
          }
        }
      },
      singleLine = true,
      shape = MaterialTheme.shapes.medium,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
    )

    when {
      rows == null && error.isNotBlank() -> ErrorState(error) { reload++ }
      rows == null -> Loading()
      visible.isNullOrEmpty() && query.isNotBlank() ->
        EmptyState("چیزی پیدا نشد", "«$query» در این بخش نیست")
      visible.isNullOrEmpty() -> EmptyState("چیزی در این بخش نیست")
      else -> LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        items(visible, key = { it.id }) { row ->
          AccountCard(row, onOpen = { if (row.openable) open = row })
        }
      }
    }
  }
}

@Composable
private fun AccountCard(row: AccountRow, onOpen: () -> Unit) {
  PanelCard(Modifier.clickable(enabled = row.openable, onClick = onOpen)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Avatar(row.title, toneColor(row.badgeTone), toneTint(row.badgeTone))
      Column(Modifier.weight(1f).padding(start = 12.dp)) {
        Text(
          row.title.ifBlank { "بی‌نام" },
          style = MaterialTheme.typography.bodyLarge,
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
          row.subtitle.ifBlank { "—" },
          Modifier.padding(top = 2.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
      }
      Chip(row.badge, toneColor(row.badgeTone), toneTint(row.badgeTone))
      if (row.openable) {
        Icon(
          Icons.AutoMirrored.Filled.KeyboardArrowLeft,
          contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.size(20.dp).padding(start = 2.dp),
        )
      }
    }
  }
}

@Composable
private fun toneColor(tone: Int): Color = when (tone) {
  TONE_GOOD -> StatusColor.good
  TONE_WARN -> StatusColor.warn
  TONE_BAD -> StatusColor.bad
  else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun toneTint(tone: Int): Color = when (tone) {
  TONE_GOOD -> StatusColor.goodTint
  TONE_WARN -> StatusColor.warnTint
  TONE_BAD -> StatusColor.badTint
  else -> StatusColor.tint
}

/* ------------------------- گرفتن و ترجمهٔ داده ---------------------------- */

private fun load(session: Session, section: Section): List<AccountRow> = when (section) {
  Section.Shops -> Api.shopAccounts(session).items("items").let { array ->
    (0 until array.length()).map { index ->
      val row = array.optJSONObject(index) ?: JSONObject()
      val days = row.optInt("daysLeft", -1)
      AccountRow(
        id = row.optString("accountId"),
        title = row.optString("name"),
        subtitle = listOf(row.optString("email"), row.optString("phone"))
          .filter { it.isNotBlank() }.joinToString(" · "),
        badge = when {
          row.optBoolean("disabled") -> "بسته"
          row.optBoolean("vip") && days >= 0 -> "$days روز"
          row.optBoolean("vip") -> "اشتراکی"
          else -> "رایگان"
        },
        badgeTone = when {
          row.optBoolean("disabled") -> TONE_BAD
          !row.optBoolean("vip") -> TONE_NEUTRAL
          days in 0..7 -> TONE_WARN
          else -> TONE_GOOD
        },
        openable = true,
      )
    }
  }

  Section.Stations -> Api.stations(session).items("stations").let { array ->
    (0 until array.length()).map { index ->
      val row = array.optJSONObject(index) ?: JSONObject()
      val online = row.optBoolean("online")
      AccountRow(
        id = row.optString("code"),
        title = row.optString("name").ifBlank { row.optString("code") },
        subtitle = "کد: ${row.optString("code")}" +
          row.optLong("lastSeenAt").let { if (it > 0) " · ${Ago.of(it)}" else "" },
        badge = if (online) "آنلاین" else "آفلاین",
        badgeTone = if (online) TONE_GOOD else TONE_NEUTRAL,
        openable = false,
      )
    }
  }

  Section.Sites -> Api.sites(session).items("sites").let { array ->
    (0 until array.length()).map { index ->
      val row = array.optJSONObject(index) ?: JSONObject()
      val running = row.optBoolean("running")
      AccountRow(
        id = row.optString("slug").ifBlank { row.optString("id") },
        title = row.optString("name"),
        subtitle = listOf(row.optString("domain"), row.optString("kind"))
          .filter { it.isNotBlank() }.joinToString(" · "),
        badge = if (running) "بالا" else "خاموش",
        badgeTone = if (running) TONE_GOOD else TONE_NEUTRAL,
        openable = false,
      )
    }
  }

  Section.Panel -> Api.panelUsers(session).items("users").let { array ->
    (0 until array.length()).map { index ->
      val row = array.optJSONObject(index) ?: JSONObject()
      AccountRow(
        id = row.optString("id"),
        title = row.optString("username"),
        subtitle = row.optLong("lastLoginAt").let {
          if (it > 0) "آخرین ورود ${Ago.of(it)}" else "هنوز وارد نشده"
        },
        badge = when (row.optString("role")) {
          "admin" -> "مدیر"
          "operator" -> "کاربر"
          else -> "بیننده"
        },
        badgeTone = if (row.optString("role") == "admin") TONE_WARN else TONE_NEUTRAL,
        openable = false,
      )
    }
  }
}
