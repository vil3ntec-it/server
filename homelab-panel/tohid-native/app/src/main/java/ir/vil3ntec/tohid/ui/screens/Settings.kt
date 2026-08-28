package ir.vil3ntec.tohid.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.sync.License
import ir.vil3ntec.tohid.sync.ServerClient
import ir.vil3ntec.tohid.sync.SyncStore
import ir.vil3ntec.tohid.sync.Syncer
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Shop
import ir.vil3ntec.tohid.ui.theme.ThemeChoice
import kotlinx.coroutines.launch

/**
 *  تنظیمات.
 *
 *  سه چیز که هرکدام دلیلِ خودش را دارد:
 *    • **پشتیبان** — تمامِ دفتر در یک فایل، با همان قالبی که نسخهٔ وب
 *      می‌سازد و می‌خواند. گوشی گم می‌شود؛ دفترِ دکان نباید با آن برود.
 *    • **تم** — روشن، تاریک، یا هرچه گوشی گفت.
 *    • **حساب و همگام‌سازی** — وصل شدن به سرورِ خودِ کاربر، بدونِ دامنه و
 *      بدونِ سرویسِ بیرونی.
 */
@Composable
fun SettingsScreen(
  store: ShopStore,
  d: ShopData,
  snackbar: SnackbarHostState,
  theme: ThemeChoice,
  onTheme: (ThemeChoice) -> Unit,
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val prefs = remember { context.getSharedPreferences("tohid", android.content.Context.MODE_PRIVATE) }
  val state = remember { SyncStore(context) }
  val syncer = remember { Syncer(store, state) }

  var storeName by remember { mutableStateOf(prefs.getString("store_name", "") ?: "") }
  var serverUrl by remember { mutableStateOf(state.serverUrl) }
  var identifier by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var signedIn by remember { mutableStateOf(state.accessToken != null) }
  var licenseStatus by remember { mutableStateOf(syncer.status()) }
  var confirmClear by remember { mutableStateOf(false) }
  var pendingRestore by remember { mutableStateOf<Uri?>(null) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  /* --------------------------- پشتیبان --------------------------- */

  val exportFile = rememberLauncherForActivityResult(
    ActivityResultContracts.CreateDocument("application/json")
  ) { uri ->
    if (uri == null) return@rememberLauncherForActivityResult
    scope.launch {
      runCatching {
        context.contentResolver.openOutputStream(uri)!!.use { out ->
          out.write(store.exportBackup(storeName).toByteArray(Charsets.UTF_8))
        }
      }.onSuccess { toast("فایل پشتیبان ساخته شد") }
        .onFailure { toast("فایل پشتیبان ساخته نشد: ${it.message ?: "دلیل نامعلوم"}") }
    }
  }

  val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) pendingRestore = uri
  }

  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
    item {
      Text("تنظیمات", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
      Spacer(Modifier.height(16.dp))

      /* ---------------------------- فروشگاه ---------------------------- */
      SectionTitle("فروشگاه")
      Panel {
        Text(
          "این نام روی سربرگ فاکتور چاپ می‌شود.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
          value = storeName,
          onValueChange = {
            storeName = it
            prefs.edit().putString("store_name", it.trim()).apply()
          },
          label = { Text("نام فروشگاه") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
          modifier = Modifier.fillMaxWidth(),
        )
      }

      Spacer(Modifier.height(20.dp))

      /* ------------------------------ تم ------------------------------ */
      SectionTitle("ظاهر")
      Panel {
        listOf(
          ThemeChoice.SYSTEM to "مثل گوشی",
          ThemeChoice.LIGHT to "روشن",
          ThemeChoice.DARK to "تاریک",
        ).forEach { (choice, label) ->
          Row(
            Modifier.fillMaxWidth().padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            RadioButton(selected = theme == choice, onClick = { onTheme(choice) })
            Spacer(Modifier.width(6.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
          }
        }
      }

      Spacer(Modifier.height(20.dp))

      /* --------------------------- پشتیبان --------------------------- */
      SectionTitle("پشتیبان‌گیری از اطلاعات")
      Panel {
        Text(
          "از تمام اطلاعات فروشگاه (قرض‌داران، محصولات، انبار، فروش‌ها و مصارف) یک فایل پشتیبان بگیرید یا از یک فایل قبلی بازیابی کنید. همین فایل در نسخهٔ وب هم باز می‌شود.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(6.dp))
        Text(
          "${plain(d.products.size)} کالا — ${plain(d.sales.size)} فاکتور — ${plain(d.debtors.size)} قرض‌دار",
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted2,
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Button(
            onClick = { exportFile.launch("tohid-shop-backup-${todayIso()}.json") },
            modifier = Modifier.weight(1f),
          ) { Text("گرفتن پشتیبان") }
          OutlinedButton(
            onClick = { pickFile.launch("application/json") },
            modifier = Modifier.weight(1f),
          ) { Text("بازیابی از فایل") }
        }
      }

      Spacer(Modifier.height(20.dp))

      /* ----------------------- حساب و همگام‌سازی ----------------------- */
      SectionTitle("حساب و همگام‌سازی")
      Panel {
        Text(
          "به سرور خودتان وصل می‌شود — نه به دامنه لازم دارد نه به سرویس بیرونی. همان نشانی‌ای که پنل سرور نشان می‌دهد.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
          value = serverUrl,
          onValueChange = { serverUrl = it; state.serverUrl = it },
          label = { Text("آدرس سرور") },
          placeholder = { Text("http://192.168.1.10:8080") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
          modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(10.dp))
        OutlinedButton(
          enabled = !busy && serverUrl.isNotBlank(),
          onClick = {
            busy = true
            scope.launch {
              runCatching { ServerClient(serverUrl).health() }
                .onSuccess { toast("سرور جواب داد") }
                .onFailure { toast((it as? ServerClient.ServerError)?.message ?: "سرور جواب نداد") }
              busy = false
            }
          },
          modifier = Modifier.fillMaxWidth(),
        ) { Text("آزمایش اتصال") }

        Spacer(Modifier.height(14.dp))

        if (!signedIn) {
          OutlinedTextField(
            value = identifier,
            onValueChange = { identifier = it },
            label = { Text("ایمیل یا شماره") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
          )
          Spacer(Modifier.height(10.dp))
          OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("رمز عبور") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
          )
          Spacer(Modifier.height(12.dp))
          Button(
            enabled = !busy && serverUrl.isNotBlank() && identifier.isNotBlank() && password.isNotBlank(),
            onClick = {
              busy = true
              scope.launch {
                runCatching { ServerClient(serverUrl).login(identifier.trim(), password) }
                  .onSuccess { session ->
                    state.accessToken = session.accessToken
                    state.refreshToken = session.refreshToken
                    state.accountName = session.name
                    signedIn = true
                    password = ""
                    toast("وارد شدید")
                    runCatching { licenseStatus = syncer.refreshLicense(android.os.Build.MODEL ?: "گوشی") }
                  }
                  .onFailure { toast((it as? ServerClient.ServerError)?.message ?: "ورود ناموفق بود") }
                busy = false
              }
            },
            modifier = Modifier.fillMaxWidth(),
          ) { Text("ورود") }

          Spacer(Modifier.height(6.dp))
          Text(
            "حساب را در پنل سرور بسازید — بخش «توحید».",
            style = MaterialTheme.typography.labelSmall,
            color = Shop.colors.muted2,
          )
        } else {
          InfoLine("حساب", state.accountName.ifBlank { "وارد شده" })
          InfoLine("اشتراک", licenseText(licenseStatus))
          licenseStatus.payload?.let { p ->
            if (p.subscriptionEndsAt > 0) {
              InfoLine("تا تاریخ", formatDate(isoOf(p.subscriptionEndsAt)))
            }
          }
          if (state.lastSyncAt > 0) {
            InfoLine("آخرین همگام‌سازی", formatDate(isoOf(state.lastSyncAt)))
          }

          Spacer(Modifier.height(12.dp))
          Button(
            enabled = !busy,
            onClick = {
              busy = true
              scope.launch {
                runCatching { syncer.run() }
                  .onSuccess {
                    toast("همگام‌سازی شد — ${plain(it.pushed)} فرستاده، ${plain(it.pulled)} گرفته")
                    runCatching { licenseStatus = syncer.refreshLicense(android.os.Build.MODEL ?: "گوشی") }
                  }
                  .onFailure { toast((it as? ServerClient.ServerError)?.message ?: "همگام‌سازی ناموفق بود") }
                busy = false
              }
            },
            modifier = Modifier.fillMaxWidth(),
          ) { Text("همگام‌سازی حالا") }

          Spacer(Modifier.height(8.dp))
          OutlinedButton(
            onClick = {
              state.signOut()
              signedIn = false
              licenseStatus = License.Status(License.State.NONE)
              toast("از حساب خارج شدید — اطلاعات دکان سر جایش است")
            },
            modifier = Modifier.fillMaxWidth(),
          ) { Text("خروج از حساب") }
        }

        if (busy) {
          Spacer(Modifier.height(10.dp))
          LinearProgressIndicator(Modifier.fillMaxWidth(), color = Shop.colors.primary)
        }
      }

      Spacer(Modifier.height(20.dp))

      /* --------------------------- پاک‌سازی --------------------------- */
      SectionTitle("پاک‌سازی")
      Panel {
        Text(
          "تمام قرض‌داران، محصولات، انبار، فروش‌ها و مصارف ثبت‌شده روی این دستگاه برای همیشه حذف می‌شوند. پیش از پاک‌سازی، حتماً یک نسخه پشتیبان بگیرید.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
          onClick = { confirmClear = true },
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
          modifier = Modifier.fillMaxWidth(),
        ) { Text("پاک‌سازی کامل اطلاعات") }
      }

      Spacer(Modifier.height(24.dp))
      Text(
        "تمام اطلاعات روی همین گوشی ذخیره می‌شود. هر چند وقت یک‌بار پشتیبان بگیرید.",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted2,
      )
      Spacer(Modifier.height(24.dp))
    }
  }

  /* ---------------------------- پنجره‌ها ---------------------------- */

  pendingRestore?.let { uri ->
    AlertDialog(
      onDismissRequest = { pendingRestore = null },
      containerColor = Shop.colors.surface,
      title = { Text("بازیابی اطلاعات؟", color = Shop.colors.text) },
      text = {
        Text(
          "با بازیابی این فایل، تمام اطلاعات فعلی این دستگاه جایگزین می‌شود. این کار قابل بازگشت نیست.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          pendingRestore = null
          scope.launch {
            val text = runCatching {
              context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
            }.getOrNull()
            if (text == null) {
              toast("فایل خوانده نشد")
            } else {
              store.importJson(text)
                .onSuccess { toast("اطلاعات با موفقیت بازیابی شد") }
                .onFailure { toast("فایل پشتیبان معتبر نیست") }
            }
          }
        }) { Text("بازیابی", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { pendingRestore = null }) { Text("انصراف") } },
    )
  }

  if (confirmClear) {
    AlertDialog(
      onDismissRequest = { confirmClear = false },
      containerColor = Shop.colors.surface,
      title = { Text("پاک‌سازی کامل اطلاعات؟", color = Shop.colors.text) },
      text = {
        Text(
          "همه چیز روی این دستگاه پاک می‌شود و برنمی‌گردد. اگر پشتیبان نگرفته‌اید، اول پشتیبان بگیرید.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          confirmClear = false
          scope.launch {
            store.save(ShopData())
            toast("تمام اطلاعات پاک شد")
          }
        }) { Text("پاک کن", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("انصراف") } },
    )
  }
}

@Composable
private fun InfoLine(label: String, value: String) {
  Row(
    Modifier.fillMaxWidth().padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
    Text(value, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
  }
}

private fun licenseText(status: License.Status): String = when (status.state) {
  License.State.ACTIVE -> status.payload?.planTitle ?: "فعال"
  License.State.GRACE -> "تمام شده — در مهلت"
  License.State.EXPIRED -> "تمام شده"
  License.State.PENDING -> "هنوز شروع نشده"
  License.State.INVALID -> "مجوز معتبر نیست"
  License.State.NONE -> "بدون اشتراک"
}

private fun isoOf(millis: Long): String {
  val c = java.util.Calendar.getInstance().apply { timeInMillis = millis }
  val y = c.get(java.util.Calendar.YEAR)
  val m = (c.get(java.util.Calendar.MONTH) + 1).toString().padStart(2, '0')
  val d = c.get(java.util.Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
  return "$y-$m-$d"
}
