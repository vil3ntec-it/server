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
        versionCode = 29
        versionName = "3.3"
    }

    signingConfigs {
        create("release") {
            storeFile = file("rawrec.jks")
            storePassword = "rawrec123"
            keyAlias = "rawrec"
            keyPassword = "rawrec123"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
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
        unitTests.all { t -> System.getProperty("rawrec.previewDir")?.let { t.systemProperty("rawrec.previewDir", it) } }
    }
}

dependencies {
    // Tests only (nothing here goes into the APK): launch tests in app/src/test.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}

