package ir.vil3ntec.admin

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Pin
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import ir.vil3ntec.admin.data.Session
import ir.vil3ntec.admin.ui.AccountsScreen
import ir.vil3ntec.admin.ui.CodesScreen
import ir.vil3ntec.admin.ui.HomeScreen
import ir.vil3ntec.admin.ui.LoginScreen
import ir.vil3ntec.admin.ui.SupportScreen
import ir.vil3ntec.admin.ui.VillainAdminTheme
import ir.vil3ntec.admin.work.WatchService

class MainActivity : ComponentActivity() {

  private val askNotifications =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* پاسخ هرچه باشد، برنامه کار می‌کند */ }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    /*
     *  اجازهٔ اعلان از اندروید ۱۳ به بعد لازم است. بدونِ آن، «تا برنامه
     *  بسته هم خبر بده» اصلاً کار نمی‌کند و کاربر هیچ‌وقت نمی‌فهمد چرا.
     */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    val store = (application as AdminApp).store

    setContent {
      VillainAdminTheme {
        // کلِ برنامه راست‌چین است
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
          Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            var session by remember { mutableStateOf(store.load()) }

            if (!session.loggedIn) {
              LoginScreen(
                initialUrl = session.serverUrl,
                onDone = { fresh ->
                  store.save(fresh)
                  session = fresh
                  if (store.watchEnabled) runCatching { WatchService.start(this@MainActivity) }
                },
              )
            } else {
              MainShell(
                session = session,
                onLogout = {
                  store.clearToken()
                  WatchService.stop(this@MainActivity)
                  session = session.copy(token = null)
                },
              )
            }
          }
        }
      }
    }
  }
}

private enum class Tab(val title: String) {
  Home("خانه"),
  Codes("کدها"),
  Accounts("حساب‌ها"),
  Support("پشتیبانی"),
}

@Composable
private fun MainShell(session: Session, onLogout: () -> Unit) {
  var tab by remember { mutableStateOf(Tab.Home) }
  // شمارهٔ پیام‌های خوانده‌نشده، تا نقطهٔ قرمزِ تبِ پشتیبانی درست باشد
  var unread by remember { mutableIntStateOf(0) }

  Scaffold(
    bottomBar = {
      NavigationBar {
        Tab.entries.forEach { item ->
          NavigationBarItem(
            selected = tab == item,
            onClick = { tab = item },
            icon = {
              val icon = when (item) {
                Tab.Home -> Icons.Filled.Home
                Tab.Codes -> Icons.Filled.Pin
                Tab.Accounts -> Icons.Filled.Groups
                Tab.Support -> Icons.Filled.SupportAgent
              }
              if (item == Tab.Support && unread > 0) {
                BadgedBox(badge = { Badge { Text(unread.toString()) } }) {
                  Icon(icon, contentDescription = item.title)
                }
              } else {
                Icon(icon, contentDescription = item.title)
              }
            },
            label = { Text(item.title) },
          )
        }
      }
    }
  ) { padding ->
    Box(Modifier.fillMaxSize().padding(padding)) {
      when (tab) {
        Tab.Home -> HomeScreen(session, onLogout = onLogout)
        Tab.Codes -> CodesScreen(session)
        Tab.Accounts -> AccountsScreen(session)
        Tab.Support -> SupportScreen(session, onUnread = { unread = it })
      }
    }
  }
}
