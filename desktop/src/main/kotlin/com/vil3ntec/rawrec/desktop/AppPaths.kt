package com.vil3ntec.rawrec.desktop

import java.io.File

/** Where the app keeps its files, on every system. */
object AppPaths {
    private val os = System.getProperty("os.name").lowercase()
    val isWindows = os.contains("win")
    val isMac = os.contains("mac")

    /** Files that ship with the app (adb, the phone-side server): Compose's app resources, or a folder given for tests. */
    fun bundled(rel: String): File? {
        val roots = listOfNotNull(System.getProperty("compose.application.resources.dir"), System.getProperty("rawrec.resources"))
        return roots.map { File(it, rel) }.firstOrNull { it.exists() }
    }

    /** Settings and logs: %APPDATA%\RawRec, ~/Library/Application Support/RawRec, ~/.config/rawrec. */
    val data: File by lazy {
        val home = System.getProperty("user.home")
        val d = when {
            isWindows -> File(System.getenv("APPDATA") ?: "$home\\AppData\\Roaming", "RawRec")
            isMac -> File(home, "Library/Application Support/RawRec")
            else -> File(System.getenv("XDG_CONFIG_HOME") ?: "$home/.config", "rawrec")
        }
        d.mkdirs(); d
    }

    /** Recordings: the user's Videos folder (Movies on a Mac), in RawRec. */
    val videos: File by lazy {
        val home = System.getProperty("user.home")
        val d = File(home, if (isMac) "Movies/RawRec" else "Videos/RawRec")
        d.mkdirs(); d
    }
}
