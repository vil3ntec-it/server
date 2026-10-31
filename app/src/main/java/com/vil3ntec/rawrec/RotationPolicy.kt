package com.vil3ntec.rawrec

/**
 * One rotation = one decision. Fed only by the debounced display listener (1.2.2 also reacted to
 * onCapturedContentResize with a guessed orientation and compared against a plan that was still
 * being switched, which produced three switches, one of them the wrong way).
 *
 * A change of the screen's size that is not a rotation (a foldable opened or closed, the phone's
 * resolution setting) also needs a new canvas, otherwise the new picture would be scaled into the
 * old size: [onDisplay] with `resized = true`, in any orientation mode.
 */
class RotationPolicy(private val auto: Boolean, private val smartStart: Boolean, private val smartWindowMs: Long = 10_000) {
    enum class Action { NONE, RESTART, NEW_PART }

    /** The orientation the recording is (or is being switched) in. */
    var landscape: Boolean? = null
        private set

    fun start(landscapeNow: Boolean) { landscape = landscapeNow }

    /** Would [onDisplay] switch for this orientation? (Asks only; changes nothing.) */
    fun follows(landscapeNow: Boolean): Boolean = landscape != null && auto && landscapeNow != landscape

    fun onDisplay(landscapeNow: Boolean, msSinceStart: Long, resized: Boolean = false): Action {
        val cur = landscape ?: return Action.NONE
        val rotated = auto && landscapeNow != cur
        if (!rotated && !resized) return Action.NONE
        if (rotated) landscape = landscapeNow
        return if (smartStart && msSinceStart < smartWindowMs) Action.RESTART else Action.NEW_PART
    }
}
