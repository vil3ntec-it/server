package com.vil3ntec.rawrec

import android.view.Display

/** Display.Mode's constructor is hidden in the SDK (public only inside Android): made by reflection. */
fun displayMode(id: Int, w: Int, h: Int, hz: Float): Display.Mode =
    Display.Mode::class.java.getDeclaredConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
        Int::class.javaPrimitiveType, Float::class.javaPrimitiveType).apply { isAccessible = true }.newInstance(id, w, h, hz)
