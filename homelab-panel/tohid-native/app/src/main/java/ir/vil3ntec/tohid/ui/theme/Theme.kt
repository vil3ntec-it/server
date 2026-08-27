package ir.vil3ntec.tohid.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 *  رنگ‌ها — عیناً همان متغیرهای CSS نسخهٔ وب.
 *
 *  هیچ‌کدام «تقریبی» یا «نزدیک» نیستند؛ همان کدهای رنگ‌اند تا برنامه در دو
 *  نسخه یک‌شکل دیده شود.
 */
data class ShopColors(
  val bg: Color,
  val surface: Color,
  val surface2: Color,
  val border: Color,
  val text: Color,
  val muted: Color,
  val muted2: Color,
  val primary: Color,
  val primaryDark: Color,
  val primaryTint: Color,
  val success: Color,
  val successTint: Color,
  val warning: Color,
  val warningTint: Color,
  val danger: Color,
  val dangerTint: Color,
)

val LightColors = ShopColors(
  bg = Color(0xFFFFFFFF),
  surface = Color(0xFFF6F8FC),
  surface2 = Color(0xFFEEF2FA),
  border = Color(0xFFE5EAF3),
  text = Color(0xFF1A2233),
  muted = Color(0xFF7C8698),
  muted2 = Color(0xFFA4ADBD),
  primary = Color(0xFF2C5CE6),
  primaryDark = Color(0xFF1F3F9E),
  primaryTint = Color(0xFFEAF0FF),
  success = Color(0xFF18A06B),
  successTint = Color(0xFFE8F8F1),
  warning = Color(0xFFE8A13A),
  warningTint = Color(0xFFFDF3E4),
  danger = Color(0xFFE54B4B),
  dangerTint = Color(0xFFFDECEC),
)

val DarkColors = ShopColors(
  bg = Color(0xFF0F1420),
  surface = Color(0xFF161D2C),
  surface2 = Color(0xFF1C2436),
  border = Color(0xFF2A3448),
  text = Color(0xFFE8ECF5),
  muted = Color(0xFF8B95AB),
  muted2 = Color(0xFF5F6A82),
  primary = Color(0xFF5B82F0),
  primaryDark = Color(0xFF8FABF7),
  primaryTint = Color(0xFF1B2942),
  success = Color(0xFF3ECF94),
  successTint = Color(0xFF12291F),
  warning = Color(0xFFF0B955),
  warningTint = Color(0xFF2E2412),
  danger = Color(0xFFF0685F),
  dangerTint = Color(0xFF2E1616),
)

/** گِردیِ گوشه‌ها — همان --radius-sm/md/lg */
object Radius {
  val sm = 10.dp
  val md = 14.dp
  val lg = 20.dp
}

val LocalShopColors = staticCompositionLocalOf { LightColors }

/** رنگ‌های برنامه از هرجای رابط کاربری: `Shop.colors.primary` */
object Shop {
  val colors: ShopColors
    @Composable get() = LocalShopColors.current
}

@Composable
fun TohidTheme(
  dark: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val colors = if (dark) DarkColors else LightColors
  val scheme = if (dark) {
    darkColorScheme(
      primary = colors.primary,
      background = colors.bg,
      surface = colors.surface,
      onPrimary = Color.White,
      onBackground = colors.text,
      onSurface = colors.text,
      error = colors.danger,
    )
  } else {
    lightColorScheme(
      primary = colors.primary,
      background = colors.bg,
      surface = colors.surface,
      onPrimary = Color.White,
      onBackground = colors.text,
      onSurface = colors.text,
      error = colors.danger,
    )
  }

  CompositionLocalProvider(LocalShopColors provides colors) {
    MaterialTheme(colorScheme = scheme, typography = ShopTypography, content = content)
  }
}
