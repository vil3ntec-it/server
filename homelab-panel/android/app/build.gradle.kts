plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "ir.vil3ntec.tohid"
  compileSdk = 35

  defaultConfig {
    applicationId = "ir.vil3ntec.tohid"
    minSdk = 24
    targetSdk = 35
    versionCode = 1
    versionName = "1.0.0"
  }

  // امضای ثابت. این کلید راز نیست و عمداً داخلِ مخزن است: تنها کارش این
  // است که هر ساخت با همان امضا بیرون بیاید تا نسخهٔ تازه *روی* نسخهٔ قبلی
  // نصب شود. اگر هر بار کلیدِ تازه ساخته می‌شد، اندروید به‌روزرسانی را رد
  // می‌کرد و کاربر مجبور بود هر بار برنامه را پاک و از نو نصب کند —
  // یعنی همهٔ داده‌هایش را از دست بدهد.
  signingConfigs {
    create("release") {
      storeFile = file("tohid-release.jks")
      storePassword = "tohid-shop"
      keyAlias = "tohid"
      keyPassword = "tohid-shop"
    }
  }

  buildTypes {
    release {
      signingConfig = signingConfigs.getByName("release")
      // بدون کوچک‌سازی: تنها دارایی برنامه یک فایل HTML است و کدِ کاتلین
      // چند صد خط. کوچک‌سازی چیزی نمی‌برد و فقط ریسک می‌آورد.
      isMinifyEnabled = false
      isShrinkResources = false
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }

  // فایل HTML نباید فشرده شود؛ همان‌طور که هست بار می‌شود
  androidResources { noCompress += listOf("html") }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.webkit:webkit:1.12.1")
  implementation("androidx.activity:activity-ktx:1.9.3")
}
