package ir.vil3ntec.tohid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.lifecycle.lifecycleScope
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.ui.AppRoot
import ir.vil3ntec.tohid.ui.theme.ThemeChoice
import ir.vil3ntec.tohid.ui.theme.TohidTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

  private lateinit var store: ShopStore

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    store = ShopStore(applicationContext)
    lifecycleScope.launch { store.load() }

    setContent {
      // انتخابِ ظاهر بین اجراها می‌ماند
      val prefs = remember { getSharedPreferences("tohid", MODE_PRIVATE) }
      var theme by remember {
        mutableStateOf(
          runCatching { ThemeChoice.valueOf(prefs.getString("theme", "SYSTEM")!!) }
            .getOrDefault(ThemeChoice.SYSTEM)
        )
      }

      TohidTheme(theme) {
        // کلِ برنامه راست‌به‌چپ است
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
          AppRoot(
            store = store,
            theme = theme,
            onTheme = {
              theme = it
              prefs.edit().putString("theme", it.name).apply()
            },
          )
        }
      }
    }
  }
}
