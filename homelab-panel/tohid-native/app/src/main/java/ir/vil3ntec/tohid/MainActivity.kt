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
      TohidTheme {
        // کلِ برنامه راست‌به‌چپ است
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
          AppRoot(store)
        }
      }
    }
  }
}
