import java.io.File

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

/*
 *  نسخهٔ برنامه از روی نسخهٔ خودِ سرور خوانده می‌شود، نه دستی.
 *
 *  ⚠️ خواسته این بود: «هر به‌روزرسانی که در سرور می‌دهم در این هم بیاید».
 *  اگر شماره را این‌جا دستی می‌نوشتیم، روزی می‌رسید که سرور جلو رفته و
 *  برنامه همان‌جا مانده — و «به‌روزرسانیِ تازه» هیچ‌وقت دیده نمی‌شد. حالا
 *  هر بار که نسخهٔ سرور بالا می‌رود، ساختِ بعدیِ این برنامه هم همان شماره
 *  را می‌گیرد و خودش را به‌روز می‌بیند.
 */
fun serverVersion(): String {
  val pkg = File(rootDir, "../server/package.json")
  val found = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(pkg.readText())
  return found?.groupValues?.get(1) ?: "1.0.0"
}

/** ۱.۲۰.۳ → ۱۲۰۰۳ — تا اندروید بفهمد کدام تازه‌تر است */
fun versionCodeOf(name: String): Int {
  val parts = name.split(".", "-").mapNotNull { it.toIntOrNull() }
  val major = parts.getOrElse(0) { 0 }
  val minor = parts.getOrElse(1) { 0 }
  val patch = parts.getOrElse(2) { 0 }
  return major * 10000 + minor * 100 + patch
}

android {
  namespace = "ir.vil3ntec.admin"
  compileSdk = 35

  defaultConfig {
    applicationId = "ir.vil3ntec.admin"
    minSdk = 26
    targetSdk = 35
    versionName = serverVersion()
    versionCode = versionCodeOf(serverVersion())
  }

  /*
   *  امضای ثابت — فقط از محیط (secretِ CI)، هیچ‌چیز در مخزن.
   *
   *  امضا باید ثابت بماند تا نسخهٔ تازه *روی* نسخهٔ قبلی بنشیند. ⛔ ولی «این کلید راز نیست» درست نبود:
   *  مخزن عمومی است و هر کس فایلِ کلید و رمزش را داشت می‌توانست APKی بسازد که اندروید به‌روزرسانیِ
   *  همین برنامهٔ ادمین بداند (SEC-ART-05، از ۱۴۰۵/۰۸/۱۰). کلید و رمز از مخزن برداشته شدند؛ بسته‌بندیِ
   *  release بی این متغیرها شکست می‌خورد. چرخش: docs/RULES-fa.md، بخشِ «کلیدِ امضای برنامهٔ ادمین».
   */
  fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }
  val keystorePath: String? = env("VILLAIN_ADMIN_KEYSTORE")
  val keystorePass: String? = env("VILLAIN_ADMIN_KEYSTORE_PASSWORD")
  val keystoreAlias: String? = env("VILLAIN_ADMIN_KEY_ALIAS")
  val keystoreKeyPass: String? = env("VILLAIN_ADMIN_KEY_PASSWORD") ?: keystorePass
  val releaseSigning: Boolean = keystorePath != null && keystorePass != null && keystoreAlias != null &&
    File(keystorePath).isFile

  signingConfigs {
    create("release") {
      if (releaseSigning) {
        storeFile = File(keystorePath!!)
        storePassword = keystorePass
        keyAlias = keystoreAlias
        keyPassword = keystoreKeyPass
      }
    }
  }

  val missingSigning = !releaseSigning
  project.tasks.matching { it.name.matches(Regex("(package|bundle)Release")) }.configureEach {
    doFirst {
      if (missingSigning) {
        throw GradleException(
          "⛔ کلیدِ امضا نیست: VILLAIN_ADMIN_KEYSTORE، VILLAIN_ADMIN_KEYSTORE_PASSWORD و VILLAIN_ADMIN_KEY_ALIAS " +
            "را بدهید (در CI از secretها). کلیدی در مخزن نیست و نباید باشد."
        )
      }
    }
  }

  buildTypes {
    release {
      signingConfig = signingConfigs.getByName("release")
      isMinifyEnabled = false
      isShrinkResources = false
    }
    debug {
      //  نسخهٔ خودی با کلیدِ debugِ خودِ کامپیوتر — کلیدِ انتشار فقط در CI
      if (releaseSigning) signingConfig = signingConfigs.getByName("release")
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }

  packaging {
    resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
  implementation(composeBom)

  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-graphics")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.navigation:navigation-compose:2.8.4")

  implementation("androidx.work:work-runtime-ktx:2.9.1")
  implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
