package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.ui.theme.Shop

/**
 *  قرض‌داران — فهرست و مانده.
 *  مانده با همان فرمولِ نسخهٔ وب: آنچه گرفته منهای آنچه پس داده.
 */
@Composable
fun DebtorsScreen(d: ShopData) {
  val rows = d.debtors
    .map { it to ShopStore.debt(d, it.id) }
    .sortedByDescending { it.second }

  Column(Modifier.fillMaxSize().padding(16.dp)) {
    Text("قرض‌داران", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
    Spacer(Modifier.height(4.dp))
    Text(
      "جمع طلب: ${money(rows.sumOf { it.second.coerceAtLeast(0.0) })}",
      style = MaterialTheme.typography.bodySmall,
      color = Shop.colors.muted,
    )
    Spacer(Modifier.height(16.dp))

    if (rows.isEmpty()) {
      Panel { EmptyNote("هنوز قرض‌داری ثبت نشده.") }
      return@Column
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      items(rows) { (debtor, balance) ->
        Panel {
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
              Text(
                debtor.name.ifBlank { "بی‌نام" },
                style = MaterialTheme.typography.titleSmall,
                color = Shop.colors.text,
              )
              if (debtor.phone.isNotBlank()) {
                Text(debtor.phone, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted2)
              }
            }
            Text(
              money(balance),
              style = MaterialTheme.typography.titleSmall,
              color = when {
                balance > 0 -> Shop.colors.danger
                balance < 0 -> Shop.colors.success
                else -> Shop.colors.muted
              },
            )
          }
        }
      }
    }
  }
}
