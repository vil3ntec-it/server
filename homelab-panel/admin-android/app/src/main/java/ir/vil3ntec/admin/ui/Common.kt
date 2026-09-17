package ir.vil3ntec.admin.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/*
 *  ───────────────────────── اجزای مشترکِ ظاهر ─────────────────────────
 *
 *  ⚠️ چرا همه این‌جا: تا امروز هر صفحه کارت و عنوان و برچسبِ خودش را
 *  می‌ساخت و هیچ‌کدام دقیقاً شبیهِ آن یکی نبود — یکی ۱۴ فاصله، دیگری ۱۶؛
 *  یکی titleMedium، دیگری bodyLarge. جمعِ این ریزه‌کاری‌ها همان حسِ
 *  «به‌هم‌ریخته و قدیمی» بود. حالا یک جا تعریف می‌شوند و همه‌جا یکی‌اند.
 */

/**
 *  کلیدهای مطمئن برای یک فهرست.
 *
 *  ⚠️ این تابع از یک کِرَشِ واقعی درآمد و بی‌ربط به سلیقه است.
 *
 *  فهرستِ Compose اگر دو ردیف کلیدِ یکسان داشته باشند، *کلِ برنامه* را
 *  می‌اندازد — نه فقط آن صفحه. و کلیدِ یکسان لازم نیست عمدی باشد: کافی
 *  است نامِ فیلدی که از سرور می‌خوانیم عوض شده باشد. آن‌وقت شناسهٔ همهٔ
 *  ردیف‌ها خالی می‌شود و برنامه در همان لحظه بیرون می‌اندازد.
 *
 *  دقیقاً همین در صفحهٔ پشتیبانی اتفاق افتاد: سرور شناسه را در `id`
 *  می‌فرستاد و برنامه دنبالِ `threadId` می‌گشت.
 *
 *  حالا هر فهرستی از این‌جا کلید می‌گیرد: خالی و تکراری، جایشان را به
 *  شمارهٔ ردیف می‌دهند. اشتباهِ نامِ فیلد باز هم ممکن است پیش بیاید —
 *  ولی دیگر برنامه را نمی‌خواباند.
 */
fun <T> safeKeys(items: List<T>, id: (T) -> String): List<Pair<String, T>> {
  val seen = HashSet<String>(items.size)
  return items.mapIndexed { index, item ->
    val raw = runCatching { id(item) }.getOrDefault("")
    val key = if (raw.isBlank() || !seen.add(raw)) "#$index" else raw
    key to item
  }
}

/**
 *  کارتِ استاندارد — با خطِ دور، بی سایه.
 *
 *  ⚠️ سایه عمداً برداشته شد: کارتِ سایه‌دار روی پس‌زمینهٔ تیره لکهٔ مات
 *  می‌شود و همان چیزی است که برنامه را «اندروید ۵» نشان می‌داد. فروشگاه
 *  هم خطِ دور دارد نه سایه.
 */
@Composable
fun PanelCard(
  modifier: Modifier = Modifier,
  content: @Composable ColumnScope.() -> Unit,
) {
  Card(
    modifier = modifier.fillMaxWidth(),
    shape = MaterialTheme.shapes.medium,
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    border = BorderStroke(1.dp, StatusColor.border),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
  ) {
    Column(Modifier.padding(16.dp), content = content)
  }
}

/** سرِ یک کارت: عنوان، یک خطِ توضیح، و هر چیزی که باید سمتِ دیگر بنشیند */
@Composable
fun CardHeader(
  title: String,
  hint: String = "",
  trailing: @Composable (() -> Unit)? = null,
) {
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.titleMedium)
      if (hint.isNotBlank()) {
        Text(
          hint,
          Modifier.padding(top = 3.dp),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    trailing?.invoke()
  }
}

/** عنوانِ یک بخش در دلِ صفحه */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
  Text(
    text,
    modifier.padding(top = 4.dp, bottom = 2.dp),
    style = MaterialTheme.typography.labelLarge,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
}

/** در حالِ گرفتن داده */
@Composable
fun Loading(label: String = "در حال گرفتن…") {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp)
      Text(
        label,
        Modifier.padding(top = 14.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/**
 * وقتی چیزی برای نشان دادن نیست.
 *
 * ⚠️ «خالی» و «نشد» دو چیزِ متفاوت‌اند و نباید یک شکل دیده شوند: اولی یعنی
 * کاری نمانده، دومی یعنی سرور جواب نداد و باید دوباره زد.
 */
@Composable
fun EmptyState(title: String, hint: String = "") {
  Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
      if (hint.isNotBlank()) {
        Text(
          hint,
          Modifier.padding(top = 8.dp),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          textAlign = TextAlign.Center,
        )
      }
    }
  }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit) {
  Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Box(
        Modifier
          .size(52.dp)
          .clip(CircleShape)
          .background(StatusColor.badTint),
        contentAlignment = Alignment.Center,
      ) {
        Text("!", style = MaterialTheme.typography.headlineSmall, color = StatusColor.bad)
      }
      Text(
        "نشد",
        Modifier.padding(top = 12.dp),
        style = MaterialTheme.typography.titleMedium,
      )
      Text(
        message,
        Modifier.padding(top = 6.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
      )
      FilledTonalButton(onClick = onRetry, modifier = Modifier.padding(top = 14.dp)) {
        Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
        Text("دوباره", Modifier.padding(start = 6.dp))
      }
    }
  }
}

/**
 *  برچسبِ رنگیِ کوچک — وضعیت، نقش، شمارنده.
 *
 *  ⚠️ پس‌زمینه از پالتِ تم می‌آید نه از `copy(alpha = …)`: رنگِ نیمه‌شفاف
 *  روی کارتِ تیره خاکستری می‌شد و در تمِ روشن پریده. فروشگاه برای هر رنگ
 *  یک نسخهٔ کم‌رنگِ جداگانه دارد و همان درست است.
 */
@Composable
fun Chip(text: String, color: Color, tint: Color? = null) {
  Box(
    Modifier
      .clip(RoundedCornerShape(9.dp))
      .background(tint ?: color.copy(alpha = 0.14f))
      .padding(horizontal = 9.dp, vertical = 4.dp)
  ) {
    Text(
      text,
      style = MaterialTheme.typography.labelSmall,
      color = color,
      fontWeight = FontWeight.Medium,
      maxLines = 1,
    )
  }
}

/** یک سطرِ «برچسب ← مقدار» */
@Composable
fun KeyValue(label: String, value: String, valueColor: Color? = null) {
  Row(
    Modifier.fillMaxWidth().padding(vertical = 7.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(
      label,
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(
      value.ifBlank { "—" },
      style = MaterialTheme.typography.bodyMedium,
      color = valueColor ?: MaterialTheme.colorScheme.onSurface,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/**
 *  نوارِ درصد با برچسب — پردازنده، حافظه، دیسک، و «چقدر از اشتراک مانده».
 *
 *  ⚠️ رنگ از خودِ عدد می‌آید: نوارِ همیشه‌آبی یعنی آدم باید عدد را بخواند
 *  تا بفهمد وضع خوب است یا بد. این‌طوری در یک نگاه معلوم است.
 */
@Composable
fun Meter(
  label: String,
  percent: Double,
  caption: String = "${percent.toInt()}٪",
  color: Color? = null,
) {
  val value = (percent / 100.0).coerceIn(0.0, 1.0).toFloat()
  val tone = color ?: when {
    percent >= 90 -> StatusColor.bad
    percent >= 70 -> StatusColor.warn
    else -> StatusColor.good
  }
  Column(Modifier.padding(top = 12.dp)) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(label, style = MaterialTheme.typography.labelMedium)
      Text(caption, style = MaterialTheme.typography.labelMedium, color = tone)
    }
    LinearProgressIndicator(
      progress = { value },
      color = tone,
      trackColor = StatusColor.border,
      strokeCap = androidx.compose.ui.graphics.StrokeCap.Round,
      modifier = Modifier
        .fillMaxWidth()
        .height(7.dp)
        .padding(top = 6.dp)
        .clip(RoundedCornerShape(4.dp)),
    )
  }
}

/**
 *  نشانِ گردِ یک ردیف — حرفِ اولِ نام در یک دایرهٔ رنگی.
 *
 *  ⚠️ فهرستی از کارت‌های فقط‌متنی، دیوارِ خاکستری است و چشم جایی برای
 *  گرفتن ندارد. یک دایرهٔ کوچک هر ردیف را قابلِ تشخیص می‌کند، بی آنکه
 *  لازم باشد عکسی از جایی بیاید.
 */
@Composable
fun Avatar(text: String, color: Color = MaterialTheme.colorScheme.primary, tint: Color? = null) {
  Box(
    Modifier
      .size(40.dp)
      .clip(RoundedCornerShape(13.dp))
      .background(tint ?: StatusColor.tint),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text.trim().take(1).ifBlank { "؟" },
      style = MaterialTheme.typography.titleMedium,
      color = color,
    )
  }
}

/** آیکنِ کوچکِ داخلِ دایره — برای سرِ کارت‌ها */
@Composable
fun RoundIcon(icon: ImageVector, color: Color = MaterialTheme.colorScheme.primary, tint: Color? = null) {
  Box(
    Modifier
      .size(34.dp)
      .clip(RoundedCornerShape(11.dp))
      .background(tint ?: StatusColor.tint),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(19.dp))
  }
}

/** نقطهٔ کوچکِ نفس‌کش — «این زنده است، عکس نیست» */
@Composable
fun PulseDot(color: Color, alive: Boolean = true) {
  val transition = rememberInfiniteTransition(label = "pulse")
  val alpha by transition.animateFloat(
    initialValue = 1f,
    targetValue = if (alive) 0.3f else 1f,
    animationSpec = infiniteRepeatable(tween(1_200), RepeatMode.Reverse),
    label = "alpha",
  )
  Box(
    Modifier
      .size(9.dp)
      .alpha(if (alive) alpha else 1f)
      .clip(CircleShape)
      .background(color)
  )
}
