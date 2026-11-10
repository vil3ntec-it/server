package com.vil3ntec.rawrec.desktop

import java.io.File

/**
 * Only the fake phone, for testing the installed app from outside (its own runtime, its own libraries):
 * the app runs with -Drawrec.adb=<fake adb> and talks to this. Args: h264File, portFile, fps.
 */
fun main(args: Array<String>) {
    File(args[1]).delete()
    println("fake phone waiting on ${args[1]}")
    FakePhone(File(args[0]), File(args[1]), args[2].toInt()).runInBackground().join()
}
