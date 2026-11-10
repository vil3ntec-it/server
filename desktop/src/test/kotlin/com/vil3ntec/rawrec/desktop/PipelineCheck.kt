package com.vil3ntec.rawrec.desktop

import java.io.File

/**
 * The self-test against a fake phone (no phone, no emulator): starts [FakePhone] behind a fake adb,
 * then runs the app's own [SelfTest]. Args: h264File, portFile, fps, seconds. Needs -Drawrec.adb and -Drawrec.resources.
 */
fun main(args: Array<String>) {
    File(args[1]).delete()
    FakePhone(File(args[0]), File(args[1]), args[2].toInt()).runInBackground()
    System.exit(SelfTest.run(listOf(args[3], "h264")))
}
