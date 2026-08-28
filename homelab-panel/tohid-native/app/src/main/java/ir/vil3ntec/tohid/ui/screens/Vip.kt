package ir.vil3ntec.tohid.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.sync.License
import ir.vil3ntec.tohid.sync.SyncStore
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop

/**
 *  اشتراک و قیمت‌ها — همان چیزی که نسخهٔ وب دارد.
 *
 *  نشانِ طلایی بالای داشبورد وضعیت را می‌گوید و با زدنش صفحهٔ قیمت‌ها باز
 *  می‌شود. پلن‌ها و قابلیت‌ها عیناً همان‌هایی هستند که وب نشان می‌دهد، پس
 *  کسی که آنجا قیمت دیده، اینجا همان را می‌بیند.
 *
 *  پرداخت بیرون از برنامه است: هماهنگی از راه واتساپ، همان‌طور که بود.
 */

private const val WHATSAPP = "93792236008"
private const val BUY_MESSAGE = "سلام، می‌خواهم اشتراک برنامه توحید را بخرم."

/** قابلیت‌هایی که همیشه باز است */
private val FREE_FEATURES = listOf(
  "انبار و موجودی",
  "مصارف دکان",
  "خریداری و تأمین‌کننده",
  "گزارش‌ها و سود",
  "دفتر رویدادها",
  "پشتیبان‌گیری",
  "خروجی اکسل",
)

/** قابلیت‌هایی که با اشتراک باز می‌شود */
private val PAID_FEATURES = listOf(
  "فروش (صندوق)",
  "قرض‌داران",
  "اسکنر بارکد",
  "چند کاربر روی یک دکان",
)

private data class Plan(
  val title: String,
  val price: Int,
  val badge: String = "",
  val days: Int,
)

private val PLANS = listOf(
  Plan("ماهانه", 500, days = 30),
  Plan("۶ ماهه", 2000, badge = "پیشنهاد ما", days = 180),
  Plan("۱ ساله", 3000, badge = "بیشترین صرفه", days = 365),
)

/* ============================ نشانِ طلایی ============================ */

/**
 *  نشانِ بالای داشبورد. وضعیت اشتراک را خودش از روی مجوزِ ذخیره‌شده
 *  می‌سنجد، پس هرجا گذاشته شود درست است.
 */
@Composable
fun VipBadge(onClick: () -> Unit, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val state = remember { SyncStore(context) }
  val status = remember {
    License.status(state.license, state.publicKey, state.deviceUid, System.currentTimeMillis())
  }

  val text = when (status.state) {
    License.State.ACTIVE -> "اشتراک فعال"
    License.State.GRACE -> "مهلت تمدید"
    License.State.EXPIRED -> "ارتقا به VIP"
    else -> "اشتراک و قیمت‌ها"
  }

  // تاجِ متحرک — همان تکانِ ملایمِ نسخهٔ وب
  val motion = rememberInfiniteTransition(label = "vip")
  val bob by motion.animateFloat(
    initialValue = -9f,
    targetValue = 9f,
    animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Reverse),
    label = "bob",
  )

  Row(
    modifier
      .clip(RoundedCornerShape(20.dp))
      .background(
        Brush.linearGradient(
          listOf(Color(0xFFF6D36B), Color(0xFFE0A92C), Color(0xFFF8E39A), Color(0xFFD9982A))
        )
      )
      .clickable(onClick = onClick)
      .padding(horizontal = 12.dp, vertical = 7.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(5.dp),
  ) {
    Icon(
      Icons.Filled.WorkspacePremium,
      contentDescription = null,
      tint = Color(0xFF4A3208),
      modifier = Modifier.size(16.dp).rotate(bob),
    )
    Text(
      text,
      style = MaterialTheme.typography.labelMedium,
      color = Color(0xFF4A3208),
      fontWeight = FontWeight.Bold,
    )
  }
}

/* ============================ صفحهٔ قیمت‌ها ============================ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VipSheet(onDismiss: () -> Unit) {
  val context = LocalContext.current
  val state = remember { SyncStore(context) }
  val status = remember {
    License.status(state.license, state.publicKey, state.deviceUid, System.currentTimeMillis())
  }
  val signedIn = !state.accessToken.isNullOrBlank()

  fun buy(planTitle: String) {
    val text = Uri.encode("$BUY_MESSAGE ($planTitle)")
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$WHATSAPP?text=$text"))
    runCatching { context.startActivity(intent) }
  }

  ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Shop.colors.bg) {
    Column(
      Modifier
        .fillMaxWidth()
        .heightIn(max = 640.dp)
        .verticalScroll(rememberScrollState())
        .padding(start = 16.dp, end = 16.dp, bottom = 28.dp)
    ) {
      /* ---------------------- سربرگ ---------------------- */
      Column(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Radius.lg))
          .background(
            Brush.linearGradient(listOf(Shop.colors.primary, Shop.colors.primaryDark))
          )
          .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Box(
          Modifier
            .size(52.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White.copy(alpha = 0.18f)),
          contentAlignment = Alignment.Center,
        ) {
          Icon(
            Icons.Filled.WorkspacePremium,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(26.dp),
          )
        }
        Spacer(Modifier.height(12.dp))
        Text(
          "قیمت ساده برای مدیریت دکان",
          style = MaterialTheme.typography.titleLarge,
          color = Color.White,
          fontWeight = FontWeight.Bold,
          textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        Text(
          "رایگان شروع کنید. بدون هزینهٔ پنهان.",
          style = MaterialTheme.typography.bodySmall,
          color = Color.White.copy(alpha = 0.85f),
        )
      }

      Spacer(Modifier.height(14.dp))

      /* ---------------------- وضعیت کنونی ---------------------- */
      val stateText = when (status.state) {
        License.State.ACTIVE -> "اشتراک شما فعال است"
        License.State.GRACE -> "اشتراک تمام شده — مهلت تمدید"
        License.State.EXPIRED -> "اشتراک پایان یافته"
        License.State.PENDING -> "اشتراک هنوز شروع نشده"
        License.State.INVALID -> "مجوز نامعتبر است"
        License.State.NONE -> if (signedIn) "هنوز اشتراکی ندارید" else "۷ روز رایگان"
      }
      val stateDetail = when (status.state) {
        License.State.NONE ->
          if (signedIn) "برای باز شدن فروش، قرض‌داران و اسکنر، یکی از پلن‌های زیر را بگیرید."
          else "حساب بسازید و همهٔ قابلیت‌ها را ۷ روز رایگان امتحان کنید. اطلاعاتی که ثبت می‌کنید در حساب خودتان می‌ماند."
        else -> "قابلیت‌های پولی با اشتراک باز می‌شوند؛ بقیهٔ برنامه همیشه باز است."
      }
      Column(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Radius.md))
          .background(Shop.colors.primaryTint)
          .padding(14.dp)
      ) {
        Text(
          stateText,
          style = MaterialTheme.typography.titleSmall,
          color = Shop.colors.primaryDark,
          fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(4.dp))
        Text(stateDetail, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
      }

      Spacer(Modifier.height(16.dp))

      /* ---------------------- دو ستون: رایگان و VIP ---------------------- */
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        TierCard(
          title = "رایگان",
          price = "۰",
          note = "همیشه رایگان",
          features = FREE_FEATURES.map { it to true } + PAID_FEATURES.map { it to false },
          highlighted = false,
          modifier = Modifier.weight(1f),
        )
        TierCard(
          title = "اشتراک VIP",
          price = "همه‌چیز",
          note = "هر مدتی که بخواهید",
          features = (FREE_FEATURES + PAID_FEATURES).map { it to true },
          highlighted = true,
          modifier = Modifier.weight(1f),
        )
      }

      Spacer(Modifier.height(18.dp))
      Text(
        "مدت اشتراک را انتخاب کنید",
        style = MaterialTheme.typography.titleSmall,
        color = Shop.colors.text,
        fontWeight = FontWeight.Bold,
      )
      Spacer(Modifier.height(10.dp))

      PLANS.forEach { plan ->
        PlanRow(plan) { buy(plan.title) }
        Spacer(Modifier.height(10.dp))
      }

      Spacer(Modifier.height(6.dp))
      Button(
        onClick = { buy("بدون انتخاب مدت") },
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE0A92C)),
        modifier = Modifier.fillMaxWidth().height(52.dp),
      ) {
        Text("گرفتن اشتراک", color = Color(0xFF3A2705), fontWeight = FontWeight.Bold)
      }
      Spacer(Modifier.height(8.dp))
      Text(
        "هماهنگی و پرداخت از راه واتساپ انجام می‌شود.",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted2,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
      )
    }
  }
}

@Composable
private fun TierCard(
  title: String,
  price: String,
  note: String,
  features: List<Pair<String, Boolean>>,
  highlighted: Boolean,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(
        if (highlighted) 2.dp else 1.dp,
        if (highlighted) Shop.colors.primary else Shop.colors.border,
        RoundedCornerShape(Radius.md),
      )
      .padding(14.dp)
  ) {
    if (highlighted) {
      Box(
        Modifier
          .clip(RoundedCornerShape(8.dp))
          .background(Shop.colors.primary)
          .padding(horizontal = 8.dp, vertical = 3.dp)
      ) {
        Text("پیشنهاد ما", style = MaterialTheme.typography.labelSmall, color = Color.White)
      }
      Spacer(Modifier.height(8.dp))
    }
    Text(title, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
    Spacer(Modifier.height(4.dp))
    Text(
      price,
      style = MaterialTheme.typography.headlineSmall,
      color = Shop.colors.primary,
      fontWeight = FontWeight.Bold,
    )
    Text(note, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
    Spacer(Modifier.height(10.dp))
    features.forEach { (label, on) ->
      Row(
        Modifier.padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        Icon(
          if (on) Icons.Filled.Check else Icons.Filled.Lock,
          contentDescription = null,
          tint = if (on) Shop.colors.success else Shop.colors.muted2,
          modifier = Modifier.size(14.dp),
        )
        Text(
          label,
          style = MaterialTheme.typography.labelSmall,
          color = if (on) Shop.colors.text else Shop.colors.muted2,
        )
      }
    }
  }
}

@Composable
private fun PlanRow(plan: Plan, onClick: () -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, if (plan.badge.isBlank()) Shop.colors.border else Color(0xFFE0A92C), RoundedCornerShape(Radius.md))
      .clickable(onClick = onClick)
      .padding(14.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(plan.title, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
        if (plan.badge.isNotBlank()) {
          Box(
            Modifier
              .clip(RoundedCornerShape(8.dp))
              .background(Color(0xFFFDF3E4))
              .padding(horizontal = 8.dp, vertical = 2.dp)
          ) {
            Text(plan.badge, style = MaterialTheme.typography.labelSmall, color = Color(0xFF8A6412))
          }
        }
      }
      Spacer(Modifier.height(2.dp))
      Text(
        "حدود ${plain(plan.days)} روز",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted,
      )
    }
    Column(horizontalAlignment = Alignment.End) {
      Text(
        plain(plan.price),
        style = MaterialTheme.typography.titleMedium,
        color = Shop.colors.primary,
        fontWeight = FontWeight.Bold,
      )
      Text("افغانی", style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
    }
  }
}
