package ir.vil3ntec.tohid.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.ui.screens.*
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

private data class Tab(val id: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
  Tab("dashboard", "داشبورد", Icons.Filled.GridView),
  Tab("sale", "فروش", Icons.Filled.PointOfSale),
  Tab("debtors", "قرض‌داران", Icons.Filled.Groups),
  Tab("warehouse", "انبار", Icons.Filled.Inventory2),
  Tab("more", "بیشتر", Icons.Filled.MoreHoriz),
)

@Composable
fun AppRoot(store: ShopStore) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val data by store.data.collectAsState()
  var tab by rememberSaveable { mutableStateOf("dashboard") }
  var migration by remember { mutableStateOf<String?>(null) }

  // یک بار، هنگام اولین اجرا: دفترِ دکان از نسخهٔ قبلی آورده می‌شود
  LaunchedEffect(Unit) {
    if (store.hasData()) return@LaunchedEffect
    val legacy = runCatching { ir.vil3ntec.tohid.data.Migration.readLegacyData(context) }.getOrNull()
    if (legacy.isNullOrBlank()) return@LaunchedEffect
    store.importJson(legacy)
      .onSuccess { migration = "اطلاعات نسخهٔ قبلی آورده شد" }
      .onFailure { migration = "اطلاعات نسخهٔ قبلی خوانده نشد" }
  }

  val snackbar = remember { SnackbarHostState() }
  LaunchedEffect(migration) {
    migration?.let { scope.launch { snackbar.showSnackbar(it) } }
  }

  Scaffold(
    containerColor = Shop.colors.bg,
    snackbarHost = { SnackbarHost(snackbar) },
    bottomBar = {
      NavigationBar(containerColor = Shop.colors.surface, tonalElevation = 0.dp) {
        TABS.forEach { t ->
          NavigationBarItem(
            selected = tab == t.id,
            onClick = { tab = t.id },
            icon = { Icon(t.icon, contentDescription = t.label) },
            label = { Text(t.label, style = MaterialTheme.typography.labelSmall) },
            colors = NavigationBarItemDefaults.colors(
              selectedIconColor = Shop.colors.primary,
              selectedTextColor = Shop.colors.primary,
              unselectedIconColor = Shop.colors.muted,
              unselectedTextColor = Shop.colors.muted,
              indicatorColor = Shop.colors.primaryTint,
            ),
          )
        }
      }
    },
  ) { padding ->
    Box(
      Modifier
        .padding(padding)
        .fillMaxSize()
        .background(Shop.colors.bg)
    ) {
      when (tab) {
        "dashboard" -> DashboardScreen(data)
        "sale" -> ComingSoon("فروش (صندوق)", "اسکنر، سبد خرید، فاکتور و چاپ حرارتی")
        "debtors" -> DebtorsScreen(data)
        "warehouse" -> ComingSoon("انبار", "موجودی، ورود کالا و حرکات انبار")
        "more" -> MoreScreen(store, data)
      }
    }
  }
}
