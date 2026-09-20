package ir.vil3ntec.admin.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.ApiError
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
        val info = withContext(Dispatchers.IO) { Api.health(serverUrl, remote) }
        /*
         *  ⚠️ «جواب داد» با «جای درستی است» یکی نیست.
         *
         *  /health روی هر دو پورت هست: پنل، و پورتِ عمومی که تونل رویش
         *  باز است. یک بار چراغ روی آدرسِ تونل سبز شد و بعد ورود با «این
         *  آدرس روی سرور نیست» رد شد — چون پنل آن‌جا اصلاً سرو نمی‌شود.
         *
         *  خودِ سرور در پاسخ می‌گوید از کدام پورت آمده (mode). پس همان را
         *  می‌سنجیم، نه صرفِ جواب گرفتن.
         */
        if (info.optString("mode") == "sync-only") {
          ServerHealth(
            ServerState.Offline,
            "این آدرس فقط بخشِ عمومیِ سرور است و پنل روی آن نیست — آدرسِ admin را بگذارید",
          )
        } else {
          ServerHealth(ServerState.Online)
        }
      } catch (e: Exception) {
        /*
         *  ⚠️ «بسته» با «خاموش» یکی نیست، و نگفتنِ فرقشان یک بار کلِ ورود را
         *  به بن‌بست برد.
         *
         *  درِ دامنه تا وقتی این گوشی کلید نگرفته، به *هر* مسیری «not found»
         *  می‌دهد — حتی /health. پس چراغ قرمز می‌شد و زیرش می‌نوشت «این آدرس
         *  روی سرور نیست»، در حالی که آدرس درست بود و سرور هم روشن. آدم
         *  آدرسِ درست را پاک می‌کرد و دنبالِ آدرسِ دیگری می‌گشت.
         *
         *  حالا همان حالت را می‌شناسیم و می‌گوییم کارِ بعدی چیست: ورود.
         */
        /*
         *  ⚠️ و یک حالتِ سومی که یک بار برنامه را کاملاً از کار انداخت:
         *  گوشی کلید *دارد*، ولی آن کلید دیگر معتبر نیست — پنل از نو نصب
         *  شده یا کلید از پنل باطل شده. در به کلیدِ مرده هم همان
         *  «not found» را می‌دهد، پس برنامه می‌گفت «این آدرس روی سرور
         *  نیست» و چراغ سرخ می‌شد، با سرورِ روشن و آدرسِ کاملاً درست.
         *  حالا حقیقت گفته می‌شود و کارِ بعدی هم: ورودِ دوباره، که خودش
         *  کلیدِ تازه می‌گیرد (LoginScreen.submit).
         */
        val gateShut = e is ApiError
          && e.status == 404
          && serverUrl.startsWith("https://")
        if (gateShut) {
          ServerHealth(
            ServerState.Unknown,
            if (remote == null) "این آدرس تا ورودِ شما بسته است — نام و رمزتان را بزنید"
            else "کلیدِ این گوشی دیگر معتبر نیست — نام و رمزتان را بزنید تا کلیدِ تازه بگیرد",
          )
        } else {
          ServerHealth(ServerState.Offline, e.message.orEmpty().ifBlank { e.javaClass.simpleName })
        }
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

  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(7.dp),
  ) {
    PulseDot(color, alive = state == ServerState.Online)
    if (showLabel) {
      Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        fontWeight = FontWeight.Medium,
      )
    }
  }
}

/**
 *  همان چراغ، داخلِ یک قابِ کوچکِ رنگی.
 *
 *  ⚠️ پس‌زمینه از پالتِ تم می‌آید نه نیمه‌شفاف: `copy(alpha)` روی کارتِ
 *  تیره خاکستریِ گِل‌آلود می‌ساخت.
 */
@Composable
fun ServerStatusChip(state: ServerState) {
  val tint = when (state) {
    ServerState.Online -> StatusColor.goodTint
    ServerState.Offline -> StatusColor.badTint
    ServerState.Unknown -> StatusColor.tint
  }
  Box(
    Modifier
      .clip(RoundedCornerShape(11.dp))
      .background(tint)
      .padding(horizontal = 11.dp, vertical = 6.dp)
  ) {
    ServerStatusDot(state)
  }
}
