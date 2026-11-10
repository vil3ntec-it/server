package com.vil3ntec.rawrec.desktop

import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The phone over the USB cable: Android's own `adb` (bundled with the app, else the one on PATH or in
 * the Android SDK). Every call has a time limit, so an unplugged phone never hangs the app.
 */
class Adb(val exe: String) {

    /** A phone/tablet seen by adb: [state] is "device" when usable, "unauthorized" until the owner taps «Allow» on it. */
    data class Device(val serial: String, val state: String, val model: String) {
        val usable get() = state == "device"
        val label get() = if (model.isNotBlank()) "$model ($serial)" else serial
    }

    class Result(val code: Int, val out: String, val err: String) {
        val ok get() = code == 0
    }

    fun run(vararg args: String, timeoutMs: Long = 15_000, input: ByteArray? = null): Result {
        val p = ProcessBuilder(listOf(exe) + args).start()
        if (input != null) p.outputStream.use { it.write(input) } else p.outputStream.close()
        val out = StringBuilder(); val err = StringBuilder()
        val t1 = Thread { out.append(p.inputStream.bufferedReader().readText()) }.apply { isDaemon = true; start() }
        val t2 = Thread { err.append(p.errorStream.bufferedReader().readText()) }.apply { isDaemon = true; start() }
        if (!p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) { p.destroyForcibly(); return Result(-1, out.toString(), "timeout: adb ${args.joinToString(" ")}") }
        t1.join(1000); t2.join(1000)
        return Result(p.exitValue(), out.toString(), err.toString())
    }

    fun devices(): List<Device> {
        val r = run("devices", "-l", timeoutMs = 10_000)
        if (!r.ok) return emptyList()
        return parseDevices(r.out)
    }

    fun shell(serial: String, cmd: String, timeoutMs: Long = 15_000) = run("-s", serial, "shell", cmd, timeoutMs = timeoutMs)

    /** Android version of the phone (scrcpy's sound needs 11+, i.e. SDK 30). */
    fun sdk(serial: String): Int = shell(serial, "getprop ro.build.version.sdk").out.trim().toIntOrNull() ?: 0

    companion object {
        /** `adb devices -l` lines: "SERIAL  device usb:1-1 product:x model:Pixel_7 device:y transport_id:1". */
        fun parseDevices(out: String): List<Device> = out.lines().drop(1).mapNotNull { line ->
            val parts = line.trim().split(Regex("\\s+"))
            if (parts.size < 2 || parts[0].isBlank() || parts[0].startsWith("*")) return@mapNotNull null
            val model = parts.firstOrNull { it.startsWith("model:") }?.removePrefix("model:")?.replace('_', ' ') ?: ""
            Device(parts[0], parts[1], model)
        }

        /** The adb to use: next to the app (bundled), then PATH, then the Android SDK; null when none is found. */
        fun find(): Adb? {
            val exe = if (System.getProperty("os.name").lowercase().contains("win")) "adb.exe" else "adb"
            val candidates = buildList {
                System.getProperty("rawrec.adb")?.let { add(File(it)) }
                AppPaths.bundled("platform-tools/$exe")?.let { add(runnable(it)) }
                System.getenv("PATH")?.split(File.pathSeparator)?.forEach { add(File(it, exe)) }
                listOfNotNull(System.getenv("ANDROID_HOME"), System.getenv("ANDROID_SDK_ROOT")).forEach { add(File(it, "platform-tools/$exe")) }
            }
            return candidates.firstOrNull { it.isFile && it.canExecute() }?.let { Adb(it.absolutePath) }
        }

        /**
         * Installers (jpackage) drop the "may run" mark from the bundled adb on Linux and macOS, and an
         * installed app's folder is not the user's to change: then a copy in the app's own data folder,
         * marked runnable, is used (made again when the bundled one changes).
         */
        internal fun runnable(bundled: File, dataDir: File = AppPaths.data): File {
            if (bundled.canExecute()) return bundled
            val copy = File(dataDir, "platform-tools/${bundled.name}")
            try {
                if (!copy.isFile || copy.length() != bundled.length() || copy.lastModified() < bundled.lastModified()) {
                    copy.parentFile.mkdirs()
                    val tmp = File(copy.parentFile, copy.name + ".tmp")
                    bundled.copyTo(tmp, overwrite = true)
                    tmp.setExecutable(true, false)
                    if (!tmp.renameTo(copy)) { copy.delete(); tmp.renameTo(copy) }
                }
                if (!copy.canExecute()) copy.setExecutable(true, false)
            } catch (_: Exception) { return bundled }
            return copy
        }
    }
}
