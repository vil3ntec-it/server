package ir.vil3ntec.tohid.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ir.vil3ntec.tohid.R

/**
 *  همان فونتِ وزیرمتن که نسخهٔ وب استفاده می‌کند — این بار داخلِ خودِ
 *  برنامه، پس بدونِ اینترنت هم درست است.
 */
val Vazirmatn = FontFamily(
  Font(R.font.vazirmatn_regular, FontWeight.Normal),
  Font(R.font.vazirmatn_medium, FontWeight.Medium),
  Font(R.font.vazirmatn_semibold, FontWeight.SemiBold),
  Font(R.font.vazirmatn_bold, FontWeight.Bold),
)

private fun style(size: Int, weight: FontWeight, line: Int) =
  TextStyle(fontFamily = Vazirmatn, fontSize = size.sp, fontWeight = weight, lineHeight = line.sp)

val ShopTypography = Typography(
  displaySmall = style(28, FontWeight.Bold, 36),
  headlineMedium = style(22, FontWeight.Bold, 30),
  headlineSmall = style(18, FontWeight.SemiBold, 26),
  titleMedium = style(16, FontWeight.SemiBold, 24),
  titleSmall = style(14, FontWeight.Medium, 20),
  bodyLarge = style(15, FontWeight.Normal, 24),
  bodyMedium = style(14, FontWeight.Normal, 22),
  bodySmall = style(12, FontWeight.Normal, 18),
  labelLarge = style(14, FontWeight.Medium, 20),
  labelMedium = style(12, FontWeight.Medium, 16),
  labelSmall = style(11, FontWeight.Medium, 14),
)
