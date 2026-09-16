package ir.vil3ntec.admin.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** در حالِ گرفتن داده */
@Composable
fun Loading(label: String = "در حال گرفتن…") {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
      Text(label, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        Text(hint, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
      }
    }
  }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit) {
  Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Text("نشد", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
      Text(message, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
      TextButton(onClick = onRetry, modifier = Modifier.padding(top = 8.dp)) {
        Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
        Text("دوباره", Modifier.padding(start = 6.dp))
      }
    }
  }
}

/** برچسبِ رنگیِ کوچک — وضعیت، نقش، شمارنده */
@Composable
fun Chip(text: String, color: androidx.compose.ui.graphics.Color) {
  Box(
    Modifier
      .clip(RoundedCornerShape(8.dp))
      .background(color.copy(alpha = 0.15f))
      .padding(horizontal = 8.dp, vertical = 3.dp)
  ) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = color)
  }
}

/** یک سطرِ «برچسب ← مقدار» */
@Composable
fun KeyValue(label: String, value: String) {
  Row(
    Modifier.fillMaxWidth().padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(label, style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(value.ifBlank { "—" }, style = MaterialTheme.typography.bodyMedium)
  }
}
