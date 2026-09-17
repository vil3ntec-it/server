package ir.vil3ntec.admin.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ir.vil3ntec.admin.R

/*
 *  رنگ‌ها همان‌هایی که در پنلِ وب هست، تا برنامه و پنل یک چیز به نظر برسند
 *  نه دو محصولِ جدا.
 */
private val Brand = Color(0xFF0F62B4)
private val BrandDark = Color(0xFF5AA7F0)
private val Good = Color(0xFF17A34A)
private val Warn = Color(0xFFD97706)
private val Bad = Color(0xFFDC2626)

private val LightColors = lightColorScheme(
  primary = Brand,
  onPrimary = Color.White,
  secondary = Color(0xFF0B4C8C),
  background = Color(0xFFF2F5FA),
  onBackground = Color(0xFF101A2B),
  surface = Color.White,
  onSurface = Color(0xFF101A2B),
  surfaceVariant = Color(0xFFE7EDF6),
  onSurfaceVariant = Color(0xFF4A5568),
  outline = Color(0xFFDCE3ED),
  error = Bad,
)

private val DarkColors = darkColorScheme(
  primary = BrandDark,
  onPrimary = Color(0xFF06203D),
  secondary = Color(0xFF8FC4F7),
  background = Color(0xFF0B1220),
  onBackground = Color(0xFFE6EDF7),
  surface = Color(0xFF131C2E),
  onSurface = Color(0xFFE6EDF7),
  surfaceVariant = Color(0xFF1C2840),
  onSurfaceVariant = Color(0xFFA8B6CC),
  outline = Color(0xFF2A3854),
  error = Color(0xFFF87171),
)

/** رنگِ وضعیت — یک جا، تا همه‌جای برنامه یکی باشد */
object StatusColor {
  val good = Good
  val warn = Warn
  val bad = Bad
}

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
    headlineLarge = base.headlineLarge.copy(fontFamily = Vazir),
    headlineMedium = base.headlineMedium.copy(fontFamily = Vazir),
    headlineSmall = base.headlineSmall.copy(fontFamily = Vazir),
    titleLarge = base.titleLarge.copy(fontFamily = Vazir, fontWeight = FontWeight.Bold),
    titleMedium = base.titleMedium.copy(fontFamily = Vazir, fontWeight = FontWeight.Medium),
    titleSmall = base.titleSmall.copy(fontFamily = Vazir, fontWeight = FontWeight.Medium),
    bodyLarge = base.bodyLarge.copy(fontFamily = Vazir),
    bodyMedium = base.bodyMedium.copy(fontFamily = Vazir),
    bodySmall = base.bodySmall.copy(fontFamily = Vazir),
    labelLarge = base.labelLarge.copy(fontFamily = Vazir),
    labelMedium = base.labelMedium.copy(fontFamily = Vazir),
    labelSmall = base.labelSmall.copy(fontFamily = Vazir),
  )
}

/** ارقام همیشه لاتین و هم‌عرض — کد شش‌رقمی باید در یک نگاه خوانده شود */
val MonoDigits = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 22.sp, letterSpacing = 4.sp)

@Composable
fun VillainAdminTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = if (dark) DarkColors else LightColors,
    typography = AppTypography,
    content = content,
  )
}
