package ir.vil3ntec.admin.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.Discovery
import ir.vil3ntec.admin.data.FoundServer
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 *  اتصال به سرور و ورودِ مدیر.
 *
 *  ⚠️ آدرس را خودِ برنامه پیدا می‌کند، نه کاربر.
 *
 *  آدرسِ سرورِ خانگی با هر بار روشن شدنِ مودم عوض می‌شود و در هر خانه‌ای
 *  فرق دارد؛ هیچ آدرسی نیست که بشود از پیش در برنامه نوشت و کار کند. پس
 *  برنامه با باز شدن، در شبکه دنبالِ سرور می‌گردد و آدرس را خودش پر
 *  می‌کند — کاربر فقط نام و رمز می‌زند.
 *
 *  ⚠️ و پیش از ورود، خودِ آدرس سنجیده می‌شود: اگر این کار نشود، «سرور
 *  خاموش است» و «رمز غلط است» هر دو یک خطای گنگ می‌دهند.
 */
@Composable
fun LoginScreen(initialUrl: String, onDone: (Session) -> Unit) {
  var url by remember { mutableStateOf(initialUrl) }
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  var searching by remember { mutableStateOf(false) }
  var found by remember { mutableStateOf<List<FoundServer>>(emptyList()) }
  var searched by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  // خودِ نبض می‌داند آدرسِ خالی را نسنجد
  val state = rememberServerState(url, everyMs = 6_000)

  fun normalize(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return trimmed
    return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
    else "http://$trimmed"
  }

  fun search() {
    if (searching) return
    searching = true
    error = ""
    scope.launch {
      try {
        val servers = withContext(Dispatchers.IO) { Discovery.search() }
        found = servers
        // اولی خودش می‌نشیند تا کاربر چیزی تایپ نکند
        if (servers.isNotEmpty() && url.isBlank()) url = servers.first().url
      } catch (e: Exception) {
        error = e.message ?: "جست‌وجو نشد"
      } finally {
        searching = false
        searched = true
      }
    }
  }

  // با باز شدنِ صفحه، اگر آدرسی ذخیره نشده، خودش می‌گردد
  LaunchedEffect(Unit) {
    if (initialUrl.isBlank()) search()
  }

  fun submit() {
    if (busy) return
    val address = normalize(url)
    if (address.isBlank()) {
      error = "اول سرور را پیدا کنید یا آدرسش را بنویسید"
      return
    }
    busy = true
    error = ""
    scope.launch {
      try {
        withContext(Dispatchers.IO) { Api.health(address) }
        val reply = withContext(Dispatchers.IO) { Api.login(address, username.trim(), password) }
        val token = reply.optString("token")
        if (token.isBlank()) {
          error = "نامِ کاربری یا رمز درست نیست"
        } else {
          onDone(
            Session(
              serverUrl = address,
              token = token,
              username = reply.optJSONObject("user")?.optString("username") ?: username.trim(),
              role = reply.optJSONObject("user")?.optString("role") ?: "admin",
            )
          )
        }
      } catch (e: Exception) {
        error = e.message ?: "وصل نشد"
      } finally {
        busy = false
      }
    }
  }

  Column(
    Modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("ویلن ادمین", style = MaterialTheme.typography.headlineMedium)
    Text(
      "سرورِ خودتان را در شبکه پیدا می‌کند — فقط نام و رمز بزنید",
      Modifier.padding(top = 6.dp),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )

    Spacer(Modifier.height(24.dp))

    /* ---------------------- سرورهایی که پیدا شدند ---------------------- */

    if (searching) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text(
          "در حال گشتن در شبکه…",
          Modifier.padding(start = 8.dp),
          style = MaterialTheme.typography.bodySmall,
        )
      }
      Spacer(Modifier.height(12.dp))
    }

    found.forEach { server ->
      Card(
        Modifier
          .fillMaxWidth()
          .padding(bottom = 8.dp)
          .clickable { url = server.url },
      ) {
        Row(
          Modifier.fillMaxWidth().padding(14.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          Column(Modifier.weight(1f)) {
            Text(server.name, style = MaterialTheme.typography.bodyLarge)
            Text(
              server.url,
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          if (server.version.isNotBlank()) {
            Chip("نسخهٔ ${server.version}", MaterialTheme.colorScheme.primary)
          }
        }
      }
    }

    if (searched && found.isEmpty() && !searching) {
      Text(
        "سروری در این شبکه پیدا نشد. مطمئن شوید گوشی به همان وای‌فایِ سرور وصل است، " +
          "یا آدرس را دستی بنویسید.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
      )
      Spacer(Modifier.height(12.dp))
    }

    /* ------------------------------ آدرس ------------------------------- */

    // آدرس همیشه چپ‌چین است — آدرسِ لاتین در قابِ راست‌چین به‌هم می‌ریزد
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
      OutlinedTextField(
        value = url,
        onValueChange = { url = it },
        label = { Text("آدرسِ سرور") },
        placeholder = { Text("خودش پیدا می‌شود") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
      )
    }

    Row(
      Modifier.fillMaxWidth().padding(top = 4.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (url.isNotBlank()) ServerStatusDot(state) else Spacer(Modifier.size(1.dp))
      TextButton(onClick = { search() }, enabled = !searching) {
        Text(if (searching) "…" else "پیدا کردنِ سرور")
      }
    }

    Spacer(Modifier.height(8.dp))

    OutlinedTextField(
      value = username,
      onValueChange = { username = it },
      label = { Text("نامِ کاربری") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
      modifier = Modifier.fillMaxWidth(),
    )

    Spacer(Modifier.height(12.dp))

    OutlinedTextField(
      value = password,
      onValueChange = { password = it },
      label = { Text("رمز") },
      singleLine = true,
      visualTransformation = PasswordVisualTransformation(),
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
      modifier = Modifier.fillMaxWidth(),
    )

    if (error.isNotBlank()) {
      Text(
        error,
        Modifier.fillMaxWidth().padding(top = 12.dp),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
      )
    }

    Spacer(Modifier.height(20.dp))

    Button(
      onClick = { submit() },
      enabled = !busy && url.isNotBlank(),
      modifier = Modifier.fillMaxWidth(),
    ) {
      if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
      else Text("ورود")
    }

    Text(
      "از بیرونِ خانه، آدرسِ اینترنتیِ تونل را این‌جا بگذارید.",
      Modifier.padding(top = 20.dp),
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
  }
}
