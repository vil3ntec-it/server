package ir.vil3ntec.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import ir.vil3ntec.admin.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 *  اتصال به سرور و ورودِ مدیر.
 *
 *  ⚠️ پیش از ورود، خودِ آدرس سنجیده می‌شود. اگر این کار نشود، آدرسِ غلط و
 *  رمزِ غلط هر دو یک خطای گنگ می‌دهند و آدم نمی‌فهمد کدامش را باید درست کند.
 */
@Composable
fun LoginScreen(initialUrl: String, onDone: (Session) -> Unit) {
  var url by remember { mutableStateOf(initialUrl.ifBlank { "http://192.168.1.10:4700" }) }
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf("") }
  var serverName by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()

  fun normalize(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return trimmed
    return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
    else "http://$trimmed"
  }

  fun submit() {
    if (busy) return
    val address = normalize(url)
    if (address.isBlank()) {
      error = "آدرسِ سرور را بنویسید"
      return
    }
    busy = true
    error = ""
    scope.launch {
      try {
        val info = withContext(Dispatchers.IO) { Api.health(address) }
        serverName = info.optString("panel").ifBlank { info.optString("service") } +
          info.optString("version").let { if (it.isBlank()) "" else " — نسخهٔ $it" }

        val reply = withContext(Dispatchers.IO) { Api.login(address, username.trim(), password) }
        val token = reply.optString("token")
        if (token.isBlank()) {
          error = "سرور توکن نداد — نامِ کاربری یا رمز درست نیست"
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
      "سرورِ خودتان را این‌جا بگذارید و وارد شوید",
      Modifier.padding(top = 6.dp),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )

    Spacer(Modifier.height(28.dp))

    // آدرس همیشه چپ‌چین است — آدرسِ لاتین در قابِ راست‌چین به‌هم می‌ریزد
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
      OutlinedTextField(
        value = url,
        onValueChange = { url = it },
        label = { Text("آدرسِ سرور") },
        placeholder = { Text("http://192.168.1.10:4700") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
      )
    }

    Spacer(Modifier.height(12.dp))

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

    Button(onClick = { submit() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
      if (busy) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
      } else {
        Text("ورود")
      }
    }

    if (serverName.isNotBlank()) {
      Text(
        "سرور: $serverName",
        Modifier.padding(top = 12.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    Text(
      "از بیرونِ خانه، آدرسِ اینترنتیِ تونل را بگذارید.",
      Modifier.padding(top = 24.dp),
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
  }
}
