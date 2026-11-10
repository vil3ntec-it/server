package com.vil3ntec.rawrec.desktop.studio

/**
 * Undo and redo of the owner's changes. Changes of one kind in a row (moving one layer, one slider) within
 * a moment are one step, so «undo» takes back the whole drag, not one pixel of it.
 */
class History(private val max: Int = 100, private val mergeMs: Long = 800) {
    private val undo = ArrayDeque<Studio>()
    private val redo = ArrayDeque<Studio>()
    private var lastKind = ""
    private var lastAt = 0L

    @Synchronized fun record(before: Studio, kind: String, now: Long = System.currentTimeMillis()) {
        val merge = kind.isNotEmpty() && kind == lastKind && now - lastAt < mergeMs
        if (!merge) { undo.addLast(before); if (undo.size > max) undo.removeFirst() }
        redo.clear()
        lastKind = kind; lastAt = now
    }
    @Synchronized fun undo(current: Studio): Studio? { val p = undo.removeLastOrNull() ?: return null; redo.addLast(current); lastKind = ""; return p }
    @Synchronized fun redo(current: Studio): Studio? { val n = redo.removeLastOrNull() ?: return null; undo.addLast(current); lastKind = ""; return n }
    val canUndo: Boolean @Synchronized get() = undo.isNotEmpty()
    val canRedo: Boolean @Synchronized get() = redo.isNotEmpty()
}
