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
   *  امضای ثابت. این کلید راز نیست و عمداً داخلِ مخزن است: تنها کارش این
   *  است که هر ساخت با همان امضا بیرون بیاید تا نسخهٔ تازه *روی* نسخهٔ
   *  قبلی بنشیند. با کلیدِ هر بار تازه، اندروید به‌روزرسانی را رد می‌کند و
   *  باید برنامه پاک و از نو نصب شود — یعنی همهٔ داده‌ها از دست می‌روند.
   */
  signingConfigs {
    create("release") {
      storeFile = file("villain-admin.jks")
      storePassword = "villain-admin"
      keyAlias = "villain"
      keyPassword = "villain-admin"
    }
  }

  buildTypes {
    release {
      signingConfig = signingConfigs.getByName("release")
      isMinifyEnabled = false
      isShrinkResources = false
    }
    debug {
      signingConfig = signingConfigs.getByName("release")
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
