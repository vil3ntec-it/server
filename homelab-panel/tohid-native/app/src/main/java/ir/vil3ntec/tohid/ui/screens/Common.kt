package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop

/** کارت — همان ظاهرِ .panel در نسخهٔ وب */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md))
      .padding(16.dp),
    content = content,
  )
}

/** کاشیِ عدد — همان .stat-card */
@Composable
fun StatTile(
  label: String,
  value: String,
  tint: Color = Shop.colors.primary,
  hint: String? = null,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md))
      .padding(14.dp)
  ) {
    Text(label, style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
    Spacer(Modifier.height(6.dp))
    Text(value, style = MaterialTheme.typography.headlineSmall, color = tint)
    if (hint != null) {
      Spacer(Modifier.height(2.dp))
      Text(hint, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted2)
    }
  }
}

@Composable
fun SectionTitle(text: String) {
  Text(
    text,
    style = MaterialTheme.typography.titleMedium,
    color = Shop.colors.text,
    modifier = Modifier.padding(bottom = 8.dp),
  )
}

@Composable
fun EmptyNote(text: String) {
  Box(Modifier.fillMaxWidth().padding(vertical = 28.dp), contentAlignment = Alignment.Center) {
    Text(
      text,
      style = MaterialTheme.typography.bodyMedium,
      color = Shop.colors.muted,
      textAlign = TextAlign.Center,
    )
  }
}

/**
 *  صفحه‌هایی که هنوز ساخته نشده‌اند.
 *
 *  عمداً صریح می‌گوید کدام بخش هنوز نیامده. یک صفحهٔ خالی یا نصفه‌کاره،
 *  کاربر را گمراه می‌کند که چیزی خراب است.
 */
@Composable
fun ComingSoon(title: String, detail: String) {
  Column(
    Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(title, style = MaterialTheme.typography.headlineSmall, color = Shop.colors.text)
    Spacer(Modifier.height(8.dp))
    Text(
      "این بخش در نسخهٔ بعدی می‌آید.",
      style = MaterialTheme.typography.bodyMedium,
      color = Shop.colors.muted,
      textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(4.dp))
    Text(
      detail,
      style = MaterialTheme.typography.bodySmall,
      color = Shop.colors.muted2,
      textAlign = TextAlign.Center,
    )
  }
}
