plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vil3ntec.rawrec"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vil3ntec.rawrec"
        minSdk = 29
        targetSdk = 35
        // ML Kit's translator brings native code: phones only (no emulator ABIs), smaller APK.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        versionCode = 32
        versionName = "3.6"
    }


    buildTypes {
        release {
            isMinifyEnabled = false
        }
        debug {
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Preview pictures of the real drawing code (PreviewRender, OverlayRender) only when asked:
        // gradle … -Drawrec.previewDir=/some/dir
        unitTests.all { t ->
            System.getProperty("rawrec.previewDir")?.let { t.systemProperty("rawrec.previewDir", it) }
            t.maxHeapSize = "3g"
        }
    }
}

dependencies {
    // «مترجمِ چت»: Google ML Kit translation, on the phone (language packs downloaded once).
    implementation("com.google.mlkit:translate:17.0.3")
    // which language a viewer wrote in (on the phone, ~1 MB), so any language comes out in Persian
    implementation("com.google.mlkit:language-id:17.0.6")
    // Tests only (nothing here goes into the APK): launch tests in app/src/test.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}

