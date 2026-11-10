package com.vil3ntec.rawrec.desktop

fun main(args: Array<String>) {
    if (args.firstOrNull() == "--selftest") { System.exit(SelfTest.run(args.drop(1))) }
    com.vil3ntec.rawrec.desktop.ui.launch()
}
