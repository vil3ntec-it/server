package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.toFaDigits
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 *  سابقهٔ عملیات.
 *
 *  هر کارِ مهمی که در برنامه انجام شده اینجا نوشته است: فروش، لغو،
 *  مرجوعی، خرید، پرداخت، اصلاحِ موجودی، تغییرِ قیمت، حذفِ محصول.
 *
 *  این دفتر فقط اضافه می‌شود؛ نه پاک می‌شود نه ویرایش. اگر بشود دستکاری‌اش
 *  کرد، دیگر به دردِ همان کاری که برایش هست نمی‌خورد — یعنی جوابِ «این
 *  عدد کِی و چرا عوض شد؟».
 */
@Composable
fun AuditLogScreen(d: ShopData) {
  var type by rememberSaveable { mutableStateOf<String?>(null) }

  val rows = d.auditLog
    .filter { type == null || it.type == type }
    .sortedByDescending { it.createdAt }

  // فقط نوع‌هایی که واقعاً ردیفی دارند در فیلتر می‌آیند
  val types = remember(d.auditLog) { d.auditLog.map { it.type }.distinct() }

  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
    item {
      Text("سابقه عملیات", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
      Text(
        "${plain(d.auditLog.size)} رویداد ثبت‌شده",
        style = MaterialTheme.typography.bodySmall,
        color = Shop.colors.muted,
      )
      Spacer(Modifier.height(14.dp))

      if (types.isNotEmpty()) {
        Row(
          Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          FilterChip(selected = type == null, onClick = { type = null }, label = { Text("همه") })
          types.forEach { t ->
            FilterChip(
              selected = type == t,
              onClick = { type = if (type == t) null else t },
              label = { Text(auditLabel(t)) },
            )
          }
        }
        Spacer(Modifier.height(14.dp))
      }
    }

    if (rows.isEmpty()) {
      item { Panel { EmptyNote("هنوز رویدادی ثبت نشده است.") } }
    } else {
      items(rows, key = { it.id }) { entry ->
        Row(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.md))
            .background(Shop.colors.surface)
            .padding(14.dp),
          verticalAlignment = Alignment.Top,
        ) {
          Box(
            Modifier
              .clip(RoundedCornerShape(999.dp))
              .background(auditTint(entry.type).copy(alpha = 0.14f))
              .padding(horizontal = 9.dp, vertical = 4.dp)
          ) {
            Text(
              auditLabel(entry.type),
              style = MaterialTheme.typography.labelSmall,
              color = auditTint(entry.type),
            )
          }
          Spacer(Modifier.width(10.dp))
          Column(Modifier.weight(1f)) {
            Text(entry.notes, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
            Spacer(Modifier.height(3.dp))
            Text(
              "${formatDate(entry.date)}${timeOf(entry.createdAt)?.let { " — $it" } ?: ""}",
              style = MaterialTheme.typography.labelSmall,
              color = Shop.colors.muted2,
            )
          }
        }
        Spacer(Modifier.height(8.dp))
      }
    }
  }
}

/** همان AUDIT_TYPE_LABELS نسخهٔ وب */
private fun auditLabel(type: String): String = when (type) {
  "sale" -> "ثبت فروش"
  "cancel_sale" -> "لغو فروش"
  "return" -> "مرجوعی"
  "purchase" -> "ثبت خرید"
  "customer_payment" -> "پرداخت مشتری"
  "supplier_payment" -> "پرداخت تأمین‌کننده"
  "stock_adjustment" -> "اصلاح موجودی"
  "supplier_return" -> "برگشت به تأمین‌کننده"
  "price_change" -> "تغییر قیمت"
  "delete_product" -> "حذف محصول"
  else -> type
}

@Composable
private fun auditTint(type: String): Color = when (type) {
  "sale", "customer_payment" -> Shop.colors.success
  "cancel_sale", "delete_product" -> Shop.colors.danger
  "return", "supplier_return", "stock_adjustment" -> Shop.colors.warning
  else -> Shop.colors.primary
}

private fun timeOf(createdAt: Long): String? {
  if (createdAt <= 0) return null
  return runCatching {
    SimpleDateFormat("HH:mm", Locale.US).format(Date(createdAt)).toFaDigits()
  }.getOrNull()
}
