package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Shop

/**
 *  کادرهای مشترکِ فرم‌ها.
 *
 *  یک جا نوشته شده‌اند تا همه‌جای برنامه یک‌شکل رفتار کنند: عدد همه‌جا
 *  همان‌طور پذیرفته شود، و تاریخ همه‌جا همان‌طور نوشته و نشان داده شود.
 */

/**
 * کادرِ عدد.
 *
 * رقمِ فارسی و عربی به لاتین برمی‌گردد، چون بعضی صفحه‌کلیدها فارسی
 * می‌فرستند و `toDouble` آن را نمی‌شناسد — عددی که کاربر دیده و نوشته
 * نباید بی‌صدا صفر حساب شود.
 */
@Composable
fun NumberField(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier,
) {
  OutlinedTextField(
    value = value,
    onValueChange = { raw -> onValueChange(latinDigits(raw).filter { it.isDigit() || it == '.' }) },
    label = { Text(label) },
    singleLine = true,
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    modifier = modifier,
  )
}

/** مثل بالا، با نمایشِ مبلغ به شکلِ خوانا زیرِ کادر */
@Composable
fun AmountField(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier.fillMaxWidth(),
) {
  val parsed = value.toDoubleOrNull()
  Column(modifier) {
    NumberField(value, onValueChange, label, Modifier.fillMaxWidth())
    if (parsed != null && parsed > 0) {
      Spacer(Modifier.height(4.dp))
      Text(
        "${money(parsed)} افغانی",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted,
      )
    }
  }
}

/**
 * تاریخ.
 *
 * در فایلِ داده میلادی ذخیره می‌شود (همان `YYYY-MM-DD` نسخهٔ وب)، ولی
 * چیزی که کاربر می‌بیند خورشیدی است. تقویمِ آمادهٔ اندروید میلادی است و
 * اینجا بیشتر گیج می‌کرد تا کمک، پس دو دکمهٔ «امروز» و «دیروز» گذاشته شده
 * که نودونه درصدِ کار همان است.
 */
@Composable
fun DateField(value: String, onValueChange: (String) -> Unit) {
  Text("تاریخ", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
  Spacer(Modifier.height(6.dp))
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    OutlinedTextField(
      value = value,
      onValueChange = { onValueChange(latinDigits(it).filter { c -> c.isDigit() || c == '-' }) },
      placeholder = { Text("۱۴۰۵/۰۶/۰۶") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
      supportingText = {
        if (value.isNotBlank()) {
          Text(formatDate(value), style = MaterialTheme.typography.labelSmall)
        }
      },
      modifier = Modifier.weight(1f),
    )
    TextButton(onClick = { onValueChange(todayIso()) }) { Text("امروز") }
    TextButton(onClick = { onValueChange(yesterdayIso()) }) { Text("دیروز") }
  }
}

/** انتخاب از فهرست، با امکانِ نوشتنِ مقدارِ تازه */
@Composable
fun ChipPicker(
  title: String,
  options: List<String>,
  selected: String,
  onSelect: (String) -> Unit,
  placeholder: String,
) {
  var adding by remember { mutableStateOf(false) }
  var fresh by remember { mutableStateOf("") }

  Text(title, style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
  Spacer(Modifier.height(6.dp))

  Row(
    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    // مقدارِ فعلی ممکن است در فهرست نباشد (از نسخهٔ قبلی آمده)
    val all = if (selected.isNotBlank() && !options.contains(selected)) options + selected else options
    all.forEach { option ->
      FilterChip(
        selected = selected == option,
        onClick = { onSelect(if (selected == option) "" else option) },
        label = { Text(option) },
      )
    }
    AssistChip(onClick = { adding = !adding }, label = { Text("+ تازه") })
  }

  if (adding) {
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(
        value = fresh,
        onValueChange = { fresh = it },
        placeholder = { Text(placeholder) },
        singleLine = true,
        modifier = Modifier.weight(1f),
      )
      Button(onClick = {
        val v = fresh.trim()
        if (v.isNotEmpty()) {
          onSelect(v)
          fresh = ""
          adding = false
        }
      }) { Text("افزودن") }
    }
  }
}

@Composable
fun CategoryPicker(options: List<String>, selected: String, onSelect: (String) -> Unit) =
  ChipPicker("دسته‌بندی", options, selected, onSelect, "دسته‌بندی تازه")

/** انتخابِ یکی از چند چیزِ نام‌دار — تأمین‌کننده، محصول، قرض‌دار */
@Composable
fun <T> NamedPicker(
  title: String,
  options: List<T>,
  selectedId: String?,
  idOf: (T) -> String,
  nameOf: (T) -> String,
  emptyNote: String,
  onSelect: (String) -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  val current = options.find { idOf(it) == selectedId }

  Text(title, style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
  Spacer(Modifier.height(6.dp))
  Box {
    OutlinedButton(
      onClick = { if (options.isNotEmpty()) open = true },
      modifier = Modifier.fillMaxWidth(),
    ) {
      Text(current?.let(nameOf) ?: if (options.isEmpty()) emptyNote else "انتخاب کنید")
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      options.forEach { option ->
        DropdownMenuItem(
          text = { Text(nameOf(option)) },
          onClick = { onSelect(idOf(option)); open = false },
        )
      }
    }
  }
}

private fun latinDigits(text: String): String = text.map { c ->
  when (c) {
    in '۰'..'۹' -> '0' + (c - '۰')
    in '٠'..'٩' -> '0' + (c - '٠')
    '٫', '٬' -> '.'
    else -> c
  }
}.joinToString("")

private fun yesterdayIso(): String {
  val c = java.util.Calendar.getInstance()
  c.add(java.util.Calendar.DAY_OF_MONTH, -1)
  val y = c.get(java.util.Calendar.YEAR)
  val m = (c.get(java.util.Calendar.MONTH) + 1).toString().padStart(2, '0')
  val d = c.get(java.util.Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
  return "$y-$m-$d"
}
