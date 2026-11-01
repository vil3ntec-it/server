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
        versionCode = 18
        versionName = "2.4"
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
    }
}

dependencies {
    // Tests only (nothing here goes into the APK): launch tests in app/src/test.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}

