package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.GlobalKeys

/** Listens for the global shortcuts for [args0] seconds and prints each one caught (evidence, not a test): GlobalKeysCheckKt 10 */
fun main(args: Array<String>) {
    GlobalKeys.onAction = { a -> println("GLOBAL ${a.name}") }
    GlobalKeys.onScene = { i -> println("GLOBAL SCENE ${i + 1}") }
    println(if (GlobalKeys.start()) "LISTENING" else "FAILED ${GlobalKeys.error}")
    Thread.sleep((args.getOrNull(0)?.toLongOrNull() ?: 10) * 1000)
    GlobalKeys.stop()
    println("DONE")
    System.exit(0)
}
