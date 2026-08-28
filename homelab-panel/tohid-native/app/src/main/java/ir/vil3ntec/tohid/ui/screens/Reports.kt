package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ReportEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop

/**
 *  گزارش‌ها.
 *
 *  همان چهار بخشِ نسخهٔ وب: سود و فروشِ یک بازه، وضعیتِ محصولات، حسابِ
 *  قرض‌داران و گردشِ موجودی. حساب‌ها در `ReportEngine` است، اینجا فقط
 *  نشان داده می‌شود.
 */
@Composable
fun ReportsScreen(d: ShopData) {
  var range by rememberSaveable { mutableStateOf(ReportEngine.Range.MONTH) }
  var section by rememberSaveable { mutableStateOf("sales") }
  var stockProduct by rememberSaveable { mutableStateOf<String?>(null) }

  val (from, to) = ReportEngine.rangeOf(range, todayIso())

  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
    item {
      Text("گزارشات", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
      Text(
        "سود، فروش و مصارف در بازهٔ دلخواه",
        style = MaterialTheme.typography.bodySmall,
        color = Shop.colors.muted,
      )
      Spacer(Modifier.height(14.dp))

      Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        listOf(
          "sales" to "سود و فروش",
          "products" to "محصولات",
          "debtors" to "قرض‌داران",
          "stock" to "گردش موجودی",
        ).forEach { (id, label) ->
          FilterChip(selected = section == id, onClick = { section = id }, label = { Text(label) })
        }
      }
      Spacer(Modifier.height(14.dp))
    }

    when (section) {
      "sales" -> salesSection(this, d, range, from, to) { range = it }
      "products" -> productsSection(this, d)
      "debtors" -> debtorsSection(this, d)
      else -> stockSection(this, d, stockProduct) { stockProduct = it }
    }
  }
}

/* ---------------------------- سود و فروش ---------------------------- */

private fun salesSection(
  scope: androidx.compose.foundation.lazy.LazyListScope,
  d: ShopData,
  range: ReportEngine.Range,
  from: String,
  to: String,
  onRange: (ReportEngine.Range) -> Unit,
) = with(scope) {
  item {
    Row(
      Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      listOf(
        ReportEngine.Range.TODAY to "امروز",
        ReportEngine.Range.WEEK to "۷ روز",
        ReportEngine.Range.MONTH to "این ماه",
        ReportEngine.Range.ALL to "از آغاز",
      ).forEach { (value, label) ->
        FilterChip(selected = range == value, onClick = { onRange(value) }, label = { Text(label) })
      }
    }
    Spacer(Modifier.height(6.dp))
    if (range != ReportEngine.Range.ALL) {
      Text(
        "${formatDate(from)} تا ${formatDate(to)}",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted2,
      )
    }
    Spacer(Modifier.height(12.dp))

    val r = ReportEngine.sales(d, from, to)

    StatTile(
      label = "سود خالص",
      value = "${money(r.netProfit)} افغانی",
      tint = if (r.netProfit >= 0) Shop.colors.success else Shop.colors.danger,
      hint = "${plain(r.count)} فاکتور",
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))

    Panel {
      ReportRow("جمع اقلام", r.gross)
      ReportRow("تخفیف", r.discount, negative = true)
      ReportRow("فروش خالص", r.net, strong = true)
      HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Shop.colors.border)
      ReportRow("بهای تمام‌شدهٔ کالا", r.cogs, negative = true)
      if (r.returnAmount > 0) ReportRow("مرجوعی", r.returnAmount, negative = true)
      ReportRow("سود ناخالص", r.grossProfit, strong = true)
      HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Shop.colors.border)
      ReportRow("مصارف", r.expenses, negative = true)
      ReportRow("سود خالص", r.netProfit, strong = true)
    }

    Spacer(Modifier.height(10.dp))
    Text(
      "سود هر قلم از قیمت خرید ثبت‌شده روی همان فاکتور حساب می‌شود، نه قیمت امروز.",
      style = MaterialTheme.typography.labelSmall,
      color = Shop.colors.muted2,
    )
  }
}

@Composable
private fun ReportRow(label: String, amount: Double, strong: Boolean = false, negative: Boolean = false) {
  Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(
      label,
      style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall,
      color = if (strong) Shop.colors.text else Shop.colors.muted,
    )
    Text(
      "${if (negative && amount > 0) "−" else ""}${money(amount)} افغانی",
      style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
      color = when {
        strong && amount < 0 -> Shop.colors.danger
        negative && amount > 0 -> Shop.colors.muted
        else -> Shop.colors.text
      },
      fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal,
    )
  }
}

/* ---------------------------- محصولات ---------------------------- */

private fun productsSection(
  scope: androidx.compose.foundation.lazy.LazyListScope,
  d: ShopData,
) = with(scope) {
  item {
    val r = ReportEngine.products(d)

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      StatTile("تمام‌شده", plain(r.out.size), Shop.colors.danger, modifier = Modifier.weight(1f))
      StatTile("موجودی کم", plain(r.low.size), Shop.colors.warning, modifier = Modifier.weight(1f))
    }
    Spacer(Modifier.height(8.dp))
    StatTile(
      "ارزش موجودی (به بهای خرید)",
      "${money(r.inventoryValue)} افغانی",
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(16.dp))

    RankPanel("پرفروش‌ترین", r.topSelling) { "${qty(it.quantity)} فروخته‌شده" }
    RankPanel("کم‌فروش‌ترین", r.slowest) { "${qty(it.quantity)} فروخته‌شده" }
    RankPanel("پرسودترین", r.mostProfitable) { "${money(it.profit)} افغانی" }
    RankPanel("کم‌سودترین", r.leastProfitable) { "${money(it.profit)} افغانی" }

    if (r.out.isNotEmpty() || r.low.isNotEmpty()) {
      SectionTitle("نیاز به توجه")
      Panel {
        r.out.forEach { IssueRow(it.name, "تمام‌شده", Shop.colors.danger) }
        r.low.forEach { IssueRow(it.name, "موجودی کم", Shop.colors.warning) }
      }
      Spacer(Modifier.height(16.dp))
    }
  }
}

@Composable
private fun RankPanel(
  title: String,
  rows: List<ReportEngine.ProductStat>,
  label: (ReportEngine.ProductStat) -> String,
) {
  SectionTitle(title)
  Panel {
    if (rows.isEmpty()) {
      EmptyNote("داده‌ای موجود نیست")
    } else {
      rows.forEach { stat ->
        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(stat.product.name, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
          Text(label(stat), style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
        }
      }
    }
  }
  Spacer(Modifier.height(16.dp))
}

@Composable
private fun IssueRow(name: String, label: String, tint: Color) {
  Row(
    Modifier.fillMaxWidth().padding(vertical = 5.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(name, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
    Text(label, style = MaterialTheme.typography.labelSmall, color = tint)
  }
}

/* ---------------------------- قرض‌داران ---------------------------- */

private fun debtorsSection(
  scope: androidx.compose.foundation.lazy.LazyListScope,
  d: ShopData,
) = with(scope) {
  val rows = ReportEngine.debtors(d)

  item {
    StatTile(
      "جمع طلب از مشتریان",
      "${money(rows.sumOf { it.remaining.coerceAtLeast(0.0) })} افغانی",
      Shop.colors.warning,
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
  }

  if (rows.isEmpty()) {
    item { Panel { EmptyNote("قرض‌داری ثبت نشده") } }
  } else {
    items(rows, key = { it.debtor.id }) { row ->
      Column(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Radius.md))
          .background(Shop.colors.surface)
          .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md))
          .padding(14.dp)
      ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(row.debtor.name, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
          Text(
            when {
              row.remaining > 0 -> "${money(row.remaining)} افغانی"
              row.remaining < 0 -> "${money(-row.remaining)} افغانی موجودی"
              else -> "تسویه شده"
            },
            style = MaterialTheme.typography.titleSmall,
            color = when {
              row.remaining > 0 -> Shop.colors.warning
              row.remaining < 0 -> Shop.colors.success
              else -> Shop.colors.muted
            },
          )
        }
        Spacer(Modifier.height(4.dp))
        Text(
          "فروش نسیه: ${money(row.given)} — پرداخت‌شده: ${money(row.received)}",
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}

/* -------------------------- گردشِ موجودی -------------------------- */

private fun stockSection(
  scope: androidx.compose.foundation.lazy.LazyListScope,
  d: ShopData,
  productId: String?,
  onProduct: (String?) -> Unit,
) = with(scope) {
  item {
    Row(
      Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      FilterChip(selected = productId == null, onClick = { onProduct(null) }, label = { Text("همه") })
      d.products.forEach { p ->
        FilterChip(
          selected = productId == p.id,
          onClick = { onProduct(if (productId == p.id) null else p.id) },
          label = { Text(p.name) },
        )
      }
    }
    Spacer(Modifier.height(12.dp))
  }

  val rows = ReportEngine.stockLedger(d, productId)
  if (rows.isEmpty()) {
    item { Panel { EmptyNote("هنوز حرکتی ثبت نشده") } }
  } else {
    items(rows, key = { it.id }) { m ->
      val product = d.products.find { it.id == m.productId }
      Row(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Radius.sm))
          .background(Shop.colors.surface)
          .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(Modifier.weight(1f)) {
          Text(
            product?.name ?: "(محصول حذف‌شده)",
            style = MaterialTheme.typography.bodyMedium,
            color = Shop.colors.text,
          )
          Text(
            "${formatDate(m.date)} — ${movementLabelOf(m.type)}${if (m.notes.isNotBlank()) " — ${m.notes}" else ""}",
            style = MaterialTheme.typography.labelSmall,
            color = Shop.colors.muted,
          )
        }
        Text(
          "${if (m.qty > 0) "+" else "−"}${qty(kotlin.math.abs(m.qty))}",
          style = MaterialTheme.typography.titleSmall,
          color = if (m.qty > 0) Shop.colors.success else Shop.colors.danger,
        )
      }
      Spacer(Modifier.height(6.dp))
    }
  }
}

/** همان برچسب‌های STOCK_MOVEMENT_LABELS نسخهٔ وب */
fun movementLabelOf(type: String): String = when (type) {
  "purchase_in" -> "ورود خرید"
  "sale" -> "فروش"
  "customer_return" -> "مرجوعی مشتری"
  "supplier_return" -> "برگشت به تأمین‌کننده"
  "adjustment" -> "اصلاح موجودی"
  else -> type
}
