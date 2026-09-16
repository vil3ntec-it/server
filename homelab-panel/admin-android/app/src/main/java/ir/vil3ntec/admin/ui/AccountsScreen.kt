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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Ago
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** یک ردیف در فهرستِ حساب‌ها — هر چهار بخش به همین شکل در می‌آیند */
private data class AccountRow(
  val id: String,
  val title: String,
  val subtitle: String,
  val badge: String,
  val badgeTone: Int,
  /** فقط حساب‌های فروشگاه اشتراک می‌گیرند */
  val canSubscribe: Boolean,
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
  var subscribing by remember { mutableStateOf<AccountRow?>(null) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(section, reload) {
    rows = null
    error = ""
    try {
      rows = withContext(Dispatchers.IO) { load(session, section) }
    } catch (e: Exception) {
      error = e.message ?: "وصل نشد"
    }
  }

  Column(Modifier.fillMaxSize()) {
    Text(
      "حساب‌ها",
      Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
      style = MaterialTheme.typography.headlineSmall,
    )

    ScrollableTabRow(selectedTabIndex = section.ordinal, edgePadding = 12.dp) {
      Section.entries.forEach { item ->
        Tab(
          selected = section == item,
          onClick = { section = item },
          text = { Text(item.title) },
        )
      }
    }

    when {
      rows == null && error.isNotBlank() -> ErrorState(error) { reload++ }
      rows == null -> Loading()
      rows!!.isEmpty() -> EmptyState("چیزی در این بخش نیست")
      else -> LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        items(rows!!, key = { it.id }) { row ->
          AccountCard(row, onSubscribe = { subscribing = row })
        }
      }
    }
  }

  subscribing?.let { target ->
    SubscribeDialog(
      account = target,
      onDismiss = { subscribing = null },
      onConfirm = { amount, unit ->
        scope.launch {
          runCatching {
            withContext(Dispatchers.IO) {
              Api.grantSubscription(session, target.id, "custom", amount, unit)
            }
          }
          subscribing = null
          reload++
        }
      },
    )
  }
}

@Composable
private fun AccountCard(row: AccountRow, onSubscribe: () -> Unit) {
  Card(Modifier.fillMaxWidth()) {
    Row(
      Modifier.fillMaxWidth().padding(14.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f)) {
        Text(row.title.ifBlank { "بی‌نام" }, style = MaterialTheme.typography.bodyLarge,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(row.subtitle, Modifier.padding(top = 2.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Column(horizontalAlignment = Alignment.End) {
        Chip(row.badge, toneColor(row.badgeTone))
        if (row.canSubscribe) {
          TextButton(onClick = onSubscribe) { Text("اشتراک") }
        }
      }
    }
  }
}

@Composable
private fun toneColor(tone: Int) = when (tone) {
  TONE_GOOD -> StatusColor.good
  TONE_WARN -> StatusColor.warn
  TONE_BAD -> StatusColor.bad
  else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun SubscribeDialog(
  account: AccountRow,
  onDismiss: () -> Unit,
  onConfirm: (Int, String) -> Unit,
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("اشتراک برای ${account.title}") },
    text = {
      Column {
        Text(
          "چقدر اشتراک داده شود؟",
          style = MaterialTheme.typography.bodyMedium,
        )
        Text(
          account.subtitle,
          Modifier.padding(top = 4.dp),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    },
    confirmButton = {
      Row {
        TextButton(onClick = { onConfirm(7, "day") }) { Text("۷ روز") }
        TextButton(onClick = { onConfirm(1, "month") }) { Text("۱ ماه") }
        TextButton(onClick = { onConfirm(1, "year") }) { Text("۱ سال") }
      }
    },
    dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
  )
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
        canSubscribe = true,
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
        canSubscribe = false,
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
        canSubscribe = false,
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
        canSubscribe = false,
      )
    }
  }
}
