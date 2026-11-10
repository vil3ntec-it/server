import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    kotlin("jvm") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    id("org.jetbrains.compose") version "1.7.3"
}

group = "com.vil3ntec.rawrec"
version = "1.2.0"

/** FFmpeg's native libraries for the system this build runs on (each system builds its own installer). */
val nativePlatform: String = run {
    val os = System.getProperty("os.name").lowercase()
    val arch = System.getProperty("os.arch").lowercase()
    when {
        os.contains("win") -> "windows-x86_64"
        os.contains("mac") -> if (arch.contains("aarch64") || arch.contains("arm")) "macosx-arm64" else "macosx-x86_64"
        else -> "linux-x86_64"
    }
}

dependencies {
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation("org.bytedeco:javacpp:1.5.11")
    implementation("org.bytedeco:javacpp:1.5.11:$nativePlatform")
    implementation("org.bytedeco:ffmpeg:7.1-1.5.11")
    implementation("org.bytedeco:ffmpeg:7.1-1.5.11:$nativePlatform")
    implementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
}

// the JDK that runs Gradle builds and packages it (17 on CI, any newer works too)

// The live code shared with the Android app (RTMP, rate control, several platforms at once, chat words):
// one source of truth, compiled here unchanged; the few Android types it names have desktop stand-ins.
val shared = listOf("RtmpPublisher", "RtmpSink", "MultiSink", "Mp4Writer", "PersianCasual", "YtEmoji")
sourceSets.main {
    kotlin.srcDir("../app/src/main/java")
    kotlin.include("com/vil3ntec/rawrec/desktop/**", "android/**", "com/vil3ntec/rawrec/DesktopShims.kt")
    shared.forEach { kotlin.include("com/vil3ntec/rawrec/$it.kt") }
}

tasks.test { useJUnitPlatform() }

/** The whole path against a fake phone (no phone needed): see src/test/.../PipelineCheck.kt. */
// -PcheckMain=<class> -PcheckArgs="a b c" and -Prawrec.<name>=<value> (passed on as system properties)
tasks.register<JavaExec>("pipelineCheck") {
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set((findProperty("checkMain") as String?) ?: "com.vil3ntec.rawrec.desktop.PipelineCheckKt")
    args = ((findProperty("checkArgs") as String?) ?: "").split(" ").filter { it.isNotBlank() }
    project.properties.filterKeys { it.startsWith("rawrec.") }.forEach { (k, v) -> systemProperty(k, v.toString()) }
    (findProperty("checkHome") as String?)?.let { systemProperty("user.home", it) }
}

compose.desktop {
    application {
        mainClass = "com.vil3ntec.rawrec.desktop.MainKt"
        jvmArgs += listOf("-Xmx2g", "-Dfile.encoding=UTF-8")
        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Exe, TargetFormat.Dmg, TargetFormat.Deb)
            packageName = "RawRec Desktop"
            packageVersion = "1.2.0"
            description = "Phone screen over USB, recording and live streaming"
            vendor = "VIL3NTEC"
            appResourcesRootDir.set(layout.projectDirectory.dir("appres"))
            modules("java.prefs", "java.desktop", "jdk.unsupported", "java.net.http", "java.management", "jdk.management", "jdk.crypto.ec", "jdk.localedata")
            windows { menu = true; shortcut = true; dirChooser = true; perUserInstall = true; upgradeUuid = "6f5d2c3e-8a1b-4c7e-9f3a-2b1d0e7c4a55" }
            linux { packageName = "rawrec-desktop"; debMaintainer = "rawrec@vil3ntec.invalid"; shortcut = true; menuGroup = "AudioVideo" }
            macOS { bundleID = "com.vil3ntec.rawrec.desktop" }
        }
    }
}
