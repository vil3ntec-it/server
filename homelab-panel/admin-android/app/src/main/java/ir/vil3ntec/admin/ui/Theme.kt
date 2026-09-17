package ir.vil3ntec.admin.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ir.vil3ntec.admin.R

/*
 *  ────────────────────────── پالتِ برنامهٔ فروشگاه ──────────────────────────
 *
 *  ⚠️ این رنگ‌ها اختراع نشده‌اند: مو‌به‌مو همان متغیرهای CSSِ برنامهٔ فروشگاه
 *  هستند (homelab-panel/android/.../assets/index.html). خواسته این بود که
 *  دو برنامه یک خانواده به نظر برسند، نه دو محصولِ غریبه.
 *
 *  ⚠️ و برعکسِ تمِ قبلی: آن‌جا صفحه خاکستری بود و کارت سفید. در فروشگاه
 *  صفحه سفید است و کارت کمی خاکستری — همان ترتیب این‌جا هم رعایت شده،
 *  وگرنه رنگ‌ها یکی می‌شد ولی حس‌شان نه.
 */

/* روشن */
private val L_Bg = Color(0xFFFFFFFF)
private val L_Surface = Color(0xFFF6F8FC)
private val L_Border = Color(0xFFE5EAF3)
private val L_Text = Color(0xFF1A2233)
private val L_Muted = Color(0xFF7C8698)
private val L_Primary = Color(0xFF2C5CE6)
private val L_PrimaryDark = Color(0xFF1F3F9E)
private val L_PrimaryTint = Color(0xFFEAF0FF)
private val L_Success = Color(0xFF18A06B)
private val L_SuccessTint = Color(0xFFE8F8F1)
private val L_Warning = Color(0xFFE8A13A)
private val L_WarningTint = Color(0xFFFDF3E4)
private val L_Danger = Color(0xFFE54B4B)
private val L_DangerTint = Color(0xFFFDECEC)

/* تاریک */
private val D_Bg = Color(0xFF0F1420)
private val D_Surface = Color(0xFF161D2C)
private val D_Border = Color(0xFF2A3448)
private val D_Text = Color(0xFFE8ECF5)
private val D_Muted = Color(0xFF8B95AB)
private val D_Primary = Color(0xFF5B82F0)
private val D_PrimaryDark = Color(0xFF8FABF7)
private val D_PrimaryTint = Color(0xFF1B2942)
private val D_Success = Color(0xFF3ECF94)
private val D_SuccessTint = Color(0xFF12291F)
private val D_Warning = Color(0xFFF0B955)
private val D_WarningTint = Color(0xFF2E2412)
private val D_Danger = Color(0xFFF0685F)
private val D_DangerTint = Color(0xFF2E1616)

private val LightColors = lightColorScheme(
  primary = L_Primary,
  onPrimary = Color.White,
  primaryContainer = L_PrimaryTint,
  onPrimaryContainer = L_PrimaryDark,
  secondary = L_PrimaryDark,
  onSecondary = Color.White,
  secondaryContainer = L_PrimaryTint,
  onSecondaryContainer = L_PrimaryDark,
  background = L_Bg,
  onBackground = L_Text,
  surface = L_Bg,
  onSurface = L_Text,
  surfaceVariant = L_Surface,
  onSurfaceVariant = L_Muted,
  surfaceContainer = L_Surface,
  surfaceContainerLow = L_Surface,
  surfaceContainerHigh = L_Surface,
  surfaceContainerHighest = L_Surface,
  outline = L_Border,
  outlineVariant = L_Border,
  error = L_Danger,
  onError = Color.White,
  errorContainer = L_DangerTint,
  onErrorContainer = L_Danger,
  scrim = Color(0x66101828),
)

private val DarkColors = darkColorScheme(
  primary = D_Primary,
  onPrimary = Color(0xFF0A1020),
  primaryContainer = D_PrimaryTint,
  onPrimaryContainer = D_PrimaryDark,
  secondary = D_PrimaryDark,
  onSecondary = Color(0xFF0A1020),
  secondaryContainer = D_PrimaryTint,
  onSecondaryContainer = D_PrimaryDark,
  background = D_Bg,
  onBackground = D_Text,
  surface = D_Bg,
  onSurface = D_Text,
  surfaceVariant = D_Surface,
  onSurfaceVariant = D_Muted,
  surfaceContainer = D_Surface,
  surfaceContainerLow = D_Surface,
  surfaceContainerHigh = D_Surface,
  surfaceContainerHighest = D_Surface,
  outline = D_Border,
  outlineVariant = D_Border,
  error = D_Danger,
  onError = Color(0xFF2E1616),
  errorContainer = D_DangerTint,
  onErrorContainer = D_Danger,
  scrim = Color(0x99000000),
)

/**
 *  رنگ‌هایی که Material نامی برایشان ندارد ولی برنامه لازمشان دارد:
 *  سبز/نارنجی/قرمزِ وضعیت، هر کدام با نسخهٔ کم‌رنگش برای پس‌زمینهٔ برچسب.
 *
 *  ⚠️ به تمِ جاری بسته است نه ثابت: سبزِ روشن روی پس‌زمینهٔ تیره نخوانا
 *  می‌شود و برعکس. تمِ قبلی یک سبز داشت برای هر دو حالت، و در تاریکی
 *  محو می‌شد.
 */
data class StatusPalette(
  val good: Color,
  val goodTint: Color,
  val warn: Color,
  val warnTint: Color,
  val bad: Color,
  val badTint: Color,
  val tint: Color,
  val border: Color,
)

private val LightStatus = StatusPalette(
  good = L_Success, goodTint = L_SuccessTint,
  warn = L_Warning, warnTint = L_WarningTint,
  bad = L_Danger, badTint = L_DangerTint,
  tint = L_PrimaryTint, border = L_Border,
)

private val DarkStatus = StatusPalette(
  good = D_Success, goodTint = D_SuccessTint,
  warn = D_Warning, warnTint = D_WarningTint,
  bad = D_Danger, badTint = D_DangerTint,
  tint = D_PrimaryTint, border = D_Border,
)

private val LocalStatus = staticCompositionLocalOf { LightStatus }

/** رنگِ وضعیت — همه‌جای برنامه از همین‌جا */
object StatusColor {
  val good: Color @Composable get() = LocalStatus.current.good
  val goodTint: Color @Composable get() = LocalStatus.current.goodTint
  val warn: Color @Composable get() = LocalStatus.current.warn
  val warnTint: Color @Composable get() = LocalStatus.current.warnTint
  val bad: Color @Composable get() = LocalStatus.current.bad
  val badTint: Color @Composable get() = LocalStatus.current.badTint
  val tint: Color @Composable get() = LocalStatus.current.tint
  val border: Color @Composable get() = LocalStatus.current.border
}

/*
 *  گِردیِ گوشه‌ها هم از فروشگاه: ۱۰ / ۱۴ / ۲۰.
 *
 *  ⚠️ پیش‌فرضِ Material سه‌تا عددِ دیگر دارد و همان بود که برنامه را
 *  «قدیمی» نشان می‌داد — کارت‌های کم‌گِرد کنارِ دکمه‌های خیلی‌گِرد.
 */
private val AppShapes = Shapes(
  extraSmall = RoundedCornerShape(8.dp),
  small = RoundedCornerShape(10.dp),
  medium = RoundedCornerShape(14.dp),
  large = RoundedCornerShape(20.dp),
  extraLarge = RoundedCornerShape(24.dp),
)

private val Vazir = FontFamily(
  Font(R.font.vazirmatn_regular, FontWeight.Normal),
  Font(R.font.vazirmatn_medium, FontWeight.Medium),
  Font(R.font.vazirmatn_bold, FontWeight.Bold),
)

/*
 *  همهٔ متن‌ها با وزیرمتن. فونتِ پیش‌فرضِ اندروید فارسی را می‌کشد ولی
 *  فاصله‌ها و نیم‌فاصله‌ها را بد نشان می‌دهد، و روی بعضی گوشی‌های چینی
 *  اصلاً فونتِ فارسی ندارد و متن مربع‌مربع می‌شود.
 */
private val AppTypography = Typography().let { base ->
  Typography(
    displayLarge = base.displayLarge.copy(fontFamily = Vazir),
    displayMedium = base.displayMedium.copy(fontFamily = Vazir),
    displaySmall = base.displaySmall.copy(fontFamily = Vazir),
    headlineLarge = base.headlineLarge.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    headlineMedium = base.headlineMedium.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    headlineSmall = base.headlineSmall.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    titleLarge = base.titleLarge.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    titleMedium = base.titleMedium.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    titleSmall = base.titleSmall.copy(fontFamily = Vazir, fontWeight = FontWeight.Medium),
    bodyLarge = base.bodyLarge.copy(fontFamily = Vazir),
    bodyMedium = base.bodyMedium.copy(fontFamily = Vazir),
    bodySmall = base.bodySmall.copy(fontFamily = Vazir),
    labelLarge = base.labelLarge.copy(fontFamily = Vazir, fontWeight = FontWeight.Medium),
    labelMedium = base.labelMedium.copy(fontFamily = Vazir),
    labelSmall = base.labelSmall.copy(fontFamily = Vazir),
  )
}

/** ارقام همیشه لاتین و هم‌عرض — کد شش‌رقمی باید در یک نگاه خوانده شود */
val MonoDigits = TextStyle(
  fontFamily = FontFamily.Monospace,
  fontSize = 24.sp,
  fontWeight = FontWeight.Bold,
  letterSpacing = 5.sp,
)

/**
 *  حالتِ تم — انتخابِ خودِ کاربر، نه فقط هرچه گوشی می‌گوید.
 *
 *  ⚠️ «نه دارک مودی نه لایت مودی» حرفِ درستی بود: تم از سیستم می‌آمد و
 *  هیچ راهی برای عوض کردنش در خودِ برنامه نبود. کسی که گوشی‌اش همیشه
 *  روشن است ولی برنامهٔ تیره می‌خواهد، گیر می‌کرد.
 */
enum class ThemeMode(val key: String, val title: String) {
  System("system", "خودکار"),
  Light("light", "روشن"),
  Dark("dark", "تاریک");

  companion object {
    fun of(key: String?): ThemeMode = entries.firstOrNull { it.key == key } ?: System
  }
}

@Composable
fun VillainAdminTheme(mode: ThemeMode = ThemeMode.System, content: @Composable () -> Unit) {
  val dark = when (mode) {
    ThemeMode.System -> isSystemInDarkTheme()
    ThemeMode.Light -> false
    ThemeMode.Dark -> true
  }
  CompositionLocalProvider(LocalStatus provides if (dark) DarkStatus else LightStatus) {
    MaterialTheme(
      colorScheme = if (dark) DarkColors else LightColors,
      typography = AppTypography,
      shapes = AppShapes,
      content = content,
    )
  }
}
