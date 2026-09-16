package ir.vil3ntec.admin.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.RemoteAccess
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** روشن، خاموش، یا هنوز معلوم نیست — و اگر خاموش، چرا */
enum class ServerState { Unknown, Online, Offline }

/**
 *  وضعیت به‌علاوهٔ دلیل.
 *
 *  ⚠️ دلیل عمداً نگه داشته می‌شود. «خاموش» بدونِ دلیل بدترین چیزی است که
 *  می‌شود نشان داد: سرورِ خاموش، فایروالِ بسته، آدرسِ غلط و اینترنتِ قطع
 *  همه یک شکل دیده می‌شوند و آدم نمی‌داند کدامش را درست کند.
 */
data class ServerHealth(
  val state: ServerState = ServerState.Unknown,
  val reason: String = "",
)

/**
 *  «سرور روشن است یا خاموش؟»
 *
 *  ⚠️ این را نمی‌شود از روی موفقیتِ آخرین درخواستِ صفحه فهمید: صفحه‌ای که
 *  باز نشده هیچ درخواستی نمی‌زند و آدم نمی‌فهمد سرور خوابیده یا فقط
 *  صفحه خالی است. پس یک نبضِ مستقل هر چند ثانیه /health را می‌زند.
 *
 *  مهلتش کوتاه است: سرورِ خاموش در شبکهٔ محلی فوراً «وصل نشد» می‌دهد، ولی
 *  اگر آدرس اشتباه باشد درخواست تا آخرین ثانیه منتظر می‌ماند. با مهلتِ
 *  کوتاه، «خاموش» خیلی زود دیده می‌شود نه یک دقیقه بعد.
 */
@Composable
fun rememberServerHealth(
  serverUrl: String,
  remote: RemoteAccess? = null,
  everyMs: Long = 10_000,
): ServerHealth {
  var health by remember(serverUrl, remote?.key) { mutableStateOf(ServerHealth()) }

  LaunchedEffect(serverUrl, remote?.key) {
    // آدرسی نداریم که بسنجیم — نه «خاموش»، که هنوز معلوم نیست
    if (serverUrl.isBlank()) {
      health = ServerHealth()
      return@LaunchedEffect
    }
    while (true) {
      health = try {
        withContext(Dispatchers.IO) { Api.health(serverUrl, remote) }
        ServerHealth(ServerState.Online)
      } catch (e: Exception) {
        ServerHealth(ServerState.Offline, e.message.orEmpty().ifBlank { e.javaClass.simpleName })
      }
      delay(everyMs)
    }
  }
  return health
}

/** همان، وقتی فقط خودِ وضعیت لازم است */
@Composable
fun rememberServerState(
  serverUrl: String,
  remote: RemoteAccess? = null,
  everyMs: Long = 10_000,
): ServerState = rememberServerHealth(serverUrl, remote, everyMs).state

/** چراغِ وضعیت — نقطهٔ رنگی و یک کلمه */
@Composable
fun ServerStatusDot(state: ServerState, showLabel: Boolean = true) {
  val color = when (state) {
    ServerState.Online -> StatusColor.good
    ServerState.Offline -> StatusColor.bad
    ServerState.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
  }
  val label = when (state) {
    ServerState.Online -> "روشن"
    ServerState.Offline -> "خاموش"
    ServerState.Unknown -> "در حال بررسی…"
  }

  // نقطه وقتی روشن است آرام نفس می‌کشد، تا معلوم باشد زنده است نه عکس
  val transition = rememberInfiniteTransition(label = "pulse")
  val alpha by transition.animateFloat(
    initialValue = 1f,
    targetValue = if (state == ServerState.Online) 0.35f else 1f,
    animationSpec = infiniteRepeatable(tween(1_200), RepeatMode.Reverse),
    label = "alpha",
  )

  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    Box(
      Modifier
        .size(9.dp)
        .alpha(if (state == ServerState.Online) alpha else 1f)
        .clip(CircleShape)
        .background(color)
    )
    if (showLabel) {
      Text(label, style = MaterialTheme.typography.labelMedium, color = color)
    }
  }
}

/** همان چراغ، داخلِ یک قابِ کوچکِ رنگی */
@Composable
fun ServerStatusChip(state: ServerState) {
  val color: Color = when (state) {
    ServerState.Online -> StatusColor.good
    ServerState.Offline -> StatusColor.bad
    ServerState.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
  }
  Box(
    Modifier
      .clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
      .background(color.copy(alpha = 0.14f))
      .padding(horizontal = 10.dp, vertical = 5.dp)
  ) {
    ServerStatusDot(state)
  }
}
