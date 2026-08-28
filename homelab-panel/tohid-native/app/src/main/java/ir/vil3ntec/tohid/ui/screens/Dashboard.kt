package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.fa
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.ui.theme.Shop
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun todayIso(): String =
  SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

/**
 *  داشبورد — همان عددهایی که نسخهٔ وب نشان می‌دهد، با همان فرمول‌ها.
 */
@Composable
fun DashboardScreen(d: ShopData) {
  val today = todayIso()

  val todaySales = d.sales.filter { it.date == today && it.status != "cancelled" }
  val todayTotal = todaySales.sumOf { it.finalTotal }
  val totalDebt = d.debtors.sumOf { ShopStore.debt(d, it.id) }.coerceAtLeast(0.0)
  val lowStock = d.products.count { ShopStore.stockStatus(d, it) == "low" }
  val outOfStock = d.products.count { ShopStore.stockStatus(d, it) == "out" }
  val todayExpense = d.expenses.filter { it.date == today }.sumOf { it.amount }
  val supplierDebt = d.suppliers.sumOf { ShopStore.supplierDebt(d, it.id) }.coerceAtLeast(0.0)

  Column(
    Modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(16.dp)
  ) {
    // سربرگ: عنوان در یک طرف، نشانِ طلایی اشتراک در طرف دیگر — مثل وب
    var vipOpen by remember { mutableStateOf(false) }
    Row(
      Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween,
    ) {
      Column {
        Text("داشبورد", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
        Spacer(Modifier.height(4.dp))
        Text(
          "خلاصهٔ امروزِ دکان",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      }
      VipBadge(onClick = { vipOpen = true })
    }
    if (vipOpen) VipSheet { vipOpen = false }
    Spacer(Modifier.height(16.dp))

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      StatTile(
        "فروش امروز", money(todayTotal),
        tint = Shop.colors.success,
        hint = "${todaySales.size.fa()} فاکتور",
        modifier = Modifier.weight(1f),
      )
      StatTile(
        "مصارف امروز", money(todayExpense),
        tint = Shop.colors.warning,
        modifier = Modifier.weight(1f),
      )
    }
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      StatTile(
        "طلب از مشتریان", money(totalDebt),
        tint = Shop.colors.danger,
        hint = "${d.debtors.size.fa()} قرض‌دار",
        modifier = Modifier.weight(1f),
      )
      StatTile(
        "بدهی به تأمین‌کننده", money(supplierDebt),
        tint = Shop.colors.danger,
        modifier = Modifier.weight(1f),
      )
    }
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      StatTile(
        "اجناس", d.products.size.fa(),
        hint = "${lowStock.fa()} کم، ${outOfStock.fa()} تمام",
        tint = if (outOfStock > 0) Shop.colors.danger else Shop.colors.primary,
        modifier = Modifier.weight(1f),
      )
      StatTile(
        "کل فاکتورها", d.sales.count { it.status != "cancelled" }.fa(),
        modifier = Modifier.weight(1f),
      )
    }

    Spacer(Modifier.height(20.dp))
    SectionTitle("آخرین فروش‌ها")
    Panel {
      val recent = d.sales.filter { it.status != "cancelled" }.sortedByDescending { it.createdAt }.take(6)
      if (recent.isEmpty()) {
        EmptyNote("هنوز فروشی ثبت نشده.")
      } else {
        recent.forEachIndexed { i, s ->
          if (i > 0) Spacer(Modifier.height(10.dp))
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
              "فاکتور #${(s.invoiceNumber ?: 0).fa()}",
              style = MaterialTheme.typography.bodyMedium,
              color = Shop.colors.text,
            )
            Text(
              money(s.finalTotal),
              style = MaterialTheme.typography.bodyMedium,
              color = Shop.colors.success,
            )
          }
          Text(s.date, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted2)
        }
      }
    }
    Spacer(Modifier.height(24.dp))
  }
}
