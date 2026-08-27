package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.BuildConfig
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.fa
import ir.vil3ntec.tohid.update.Updater
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  بیشتر — وضعیت برنامه، به‌روزرسانی، و بخش‌هایی که هنوز در راه‌اند.
 */
@Composable
fun MoreScreen(store: ShopStore, d: ShopData) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val prefs = remember { context.getSharedPreferences("tohid", android.content.Context.MODE_PRIVATE) }

  var repo by remember { mutableStateOf(prefs.getString("update_repo", "vil3ntec-it/server") ?: "") }
  var status by remember { mutableStateOf<String?>(null) }
  var found by remember { mutableStateOf<Updater.Release?>(null) }
  var progress by remember { mutableStateOf(-1) }
  var busy by remember { mutableStateOf(false) }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
  ) {
    Text("بیشتر", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
    Spacer(Modifier.height(16.dp))

    SectionTitle("وضعیت")
    Panel {
      InfoRow("نسخه", BuildConfig.VERSION_NAME)
      InfoRow("اجناس", d.products.size.fa())
      InfoRow("فاکتورها", d.sales.size.fa())
      InfoRow("قرض‌داران", d.debtors.size.fa())
      InfoRow("مصارف", d.expenses.size.fa())
      InfoRow("تأمین‌کننده‌ها", d.suppliers.size.fa())
    }

    Spacer(Modifier.height(20.dp))
    SectionTitle("به‌روزرسانی از گیت‌هاب")
    Panel {
      Text(
        "برای هر تغییر لازم نیست Android Studio باز کنید — نسخهٔ تازه از همین‌جا نصب می‌شود.",
        style = MaterialTheme.typography.bodySmall,
        color = Shop.colors.muted,
      )
      Spacer(Modifier.height(12.dp))

      OutlinedTextField(
        value = repo,
        onValueChange = { repo = it },
        label = { Text("مخزن (owner/repo)") },
        singleLine = true,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth(),
      )

      Spacer(Modifier.height(12.dp))

      if (progress in 0..100) {
        LinearProgressIndicator(
          progress = { progress / 100f },
          modifier = Modifier.fillMaxWidth(),
          color = Shop.colors.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
          "در حال دانلود… ${progress.fa()}٪",
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(12.dp))
      }

      val release = found
      if (release == null) {
        Button(
          enabled = !busy,
          onClick = {
            prefs.edit().putString("update_repo", repo.trim()).apply()
            busy = true; status = "در حال بررسی…"
            scope.launch {
              Updater.check(repo, BuildConfig.VERSION_NAME)
                .onSuccess {
                  found = it
                  status = if (it == null) "نسخهٔ شما تازه‌ترین است." else null
                }
                .onFailure { status = it.message ?: "بررسی ناموفق بود" }
              busy = false
            }
          },
          modifier = Modifier.fillMaxWidth(),
        ) { Text("بررسی نسخهٔ تازه") }
      } else {
        Text(
          "نسخهٔ ${release.version} آماده است",
          style = MaterialTheme.typography.titleSmall,
          color = Shop.colors.success,
        )
        if (release.notes.isNotBlank()) {
          Spacer(Modifier.height(6.dp))
          Text(
            release.notes.take(400),
            style = MaterialTheme.typography.bodySmall,
            color = Shop.colors.muted,
          )
        }
        Spacer(Modifier.height(12.dp))
        Button(
          enabled = !busy,
          onClick = {
            busy = true; progress = 0
            scope.launch {
              Updater.download(context, release) { progress = it }
                .onSuccess {
                  progress = -1
                  Updater.install(context, it)
                }
                .onFailure { status = it.message ?: "دانلود ناموفق بود"; progress = -1 }
              busy = false
            }
          },
          modifier = Modifier.fillMaxWidth(),
        ) { Text("دانلود و نصب") }
      }

      status?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
      }
    }

    Spacer(Modifier.height(20.dp))
    SectionTitle("در راه")
    Panel {
      listOf(
        "فروش (صندوق) — اسکنر، سبد، فاکتور، چاپ حرارتی",
        "انبار — موجودی، ورود کالا، حرکات",
        "مصارف و خرید و تأمین‌کننده",
        "گزارش‌ها و دفتر رویدادها",
        "اشتراک و همگام‌سازی با سرور",
      ).forEach {
        Text(
          "• $it",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
          modifier = Modifier.padding(vertical = 3.dp),
        )
      }
    }
    Spacer(Modifier.height(24.dp))
  }
}

@Composable
private fun InfoRow(label: String, value: String) {
  Row(
    Modifier.fillMaxWidth().padding(vertical = 5.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
    Text(value, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
  }
}
