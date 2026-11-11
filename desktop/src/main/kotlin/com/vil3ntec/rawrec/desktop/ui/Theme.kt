package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The desktop studio's own look — deliberately not the phone app's: a dense graphite console with thin
 * borders, one teal accent for "selected / on", amber for paid chat, red only for "on air". Numbers in
 * tabular figures so meters and timers never jitter.
 */
object K {
    val Bg = Color(0xFF0B0E13)
    val Panel = Color(0xFF11151C)
    val Raised = Color(0xFF171C25)
    /** A card inside a panel: a step lighter than the panel. */
    val Card = Color(0xFF141922)
    val Hover = Color(0xFF1E2430)
    val Line = Color(0xFF242B37)
    val LineHi = Color(0xFF333C4B)
    val Text = Color(0xFFE6EAF0)
    val Dim = Color(0xFF8B95A7)
    val Faint = Color(0xFF5B6475)
    val Accent = Color(0xFF2DD4BF)
    val AccentDim = Color(0x332DD4BF)
    val Amber = Color(0xFFF59E0B)
    val Live = Color(0xFFEF4444)
    val LiveDim = Color(0x33EF4444)
    val Good = Color(0xFF22C55E)
    val Warn = Color(0xFFF59E0B)

    val font: FontFamily by lazy {
        val cl = K::class.java.classLoader
        if (cl.getResource("fonts/Vazirmatn-Regular.ttf") != null)
            FontFamily(Font("fonts/Vazirmatn-Regular.ttf", FontWeight.Normal), Font("fonts/Vazirmatn-Bold.ttf", FontWeight.Bold))
        else FontFamily.Default
    }
}

@Composable
fun T(text: String, size: Int = 13, color: Color = K.Text, bold: Boolean = false, modifier: Modifier = Modifier, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) =
    Text(text, modifier, color = color, fontSize = size.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, fontFamily = K.font, textAlign = align, maxLines = maxLines, lineHeight = (size * 1.45).sp)

/**
 * A section of a side panel, as a card: a title (with an optional short explanation under it), then its content.
 * Cards keep each group of settings visibly together, so a long panel still reads at a glance.
 */
@Composable
fun Section(title: String, modifier: Modifier = Modifier, subtitle: String? = null, trailing: @Composable RowScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp)
        .clip(RoundedCornerShape(10.dp)).background(K.Card).border(1.dp, K.Line, RoundedCornerShape(10.dp)).padding(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(bottom = if (subtitle == null) 10.dp else 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(width = 3.dp, height = 14.dp).clip(RoundedCornerShape(2.dp)).background(K.Accent))
            Spacer(Modifier.width(8.dp))
            T(title, 13, K.Text, bold = true, modifier = Modifier.weight(1f))
            trailing()
        }
        if (subtitle != null) T(subtitle, 11, K.Faint, modifier = Modifier.padding(bottom = 10.dp))
        content()
    }
}

/** A small label above a control. */
@Composable
fun Label(text: String, modifier: Modifier = Modifier) = T(text, 11, K.Dim, modifier = modifier.padding(top = 8.dp, bottom = 4.dp))

/** A quiet explanation under a control. */
@Composable
fun Hint(text: String, color: Color = K.Faint) = T(text, 11, color, modifier = Modifier.padding(top = 4.dp))

/** A big choice: a mark, a title and one line of explanation; lit with the accent when chosen. */
@Composable
fun Tile(mark: String, title: String, subtitle: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val src = remember { MutableInteractionSource() }
    val hover by src.collectIsHoveredAsState()
    Column(modifier.clip(RoundedCornerShape(10.dp))
        .background(if (on) K.AccentDim else if (hover && enabled) K.Hover else K.Raised)
        .border(if (on) 1.5.dp else 1.dp, if (on) K.Accent else K.Line, RoundedCornerShape(10.dp))
        .hoverable(src).clickable(enabled = enabled, interactionSource = src, indication = null) { onClick() }.padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        T(mark, 22, if (on) K.Accent else K.Dim)
        T(title, 12, if (on) K.Accent else K.Text, bold = true, maxLines = 1)
        T(subtitle, 10, K.Faint, align = TextAlign.Center, maxLines = 2)
    }
}

/** The side panel's tabs: a mark over a short name, the chosen one underlined with the accent. */
@Composable
fun <V> TabBar(tabs: List<Triple<V, String, String>>, value: V, onPick: (V) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for ((v, mark, label) in tabs) {
            val sel = v == value
            val src = remember { MutableInteractionSource() }
            val hover by src.collectIsHoveredAsState()
            Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (sel) K.AccentDim else if (hover) K.Hover else Color.Transparent)
                .hoverable(src).clickable(interactionSource = src, indication = null) { onPick(v) }.padding(vertical = 5.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                T(mark, 15, if (sel) K.Accent else K.Dim)
                T(label, 10, if (sel) K.Accent else K.Dim, bold = sel, maxLines = 1)
            }
        }
    }
}

@Composable
fun HLine() = Box(Modifier.fillMaxWidth().height(1.dp).background(K.Line))

/** A flat console button; [on] lights it with the accent (or [tint]). */
@Composable
fun Btn(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, on: Boolean = false, tint: Color = K.Accent, enabled: Boolean = true, height: Dp = 30.dp, bold: Boolean = false) {
    val src = remember { MutableInteractionSource() }
    val hover by src.collectIsHoveredAsState()
    val bg = when { !enabled -> K.Raised; on -> tint.copy(alpha = 0.18f); hover -> K.Hover; else -> K.Raised }
    val border = if (on) tint else if (hover && enabled) K.LineHi else K.Line
    Box(modifier.height(height).clip(RoundedCornerShape(6.dp)).background(bg).border(1.dp, border, RoundedCornerShape(6.dp))
        .hoverable(src).clickable(enabled = enabled, interactionSource = src, indication = null) { onClick() }.padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center) {
        T(text, 12, if (!enabled) K.Faint else if (on) tint else K.Text, bold = bold || on, maxLines = 1)
    }
}

/** Several choices, one chosen (a segmented control). */
@Composable
fun <V> Seg(options: List<Pair<V, String>>, value: V, onPick: (V) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, K.Line, RoundedCornerShape(6.dp)).background(K.Raised)) {
        options.forEachIndexed { i, (v, label) ->
            val sel = v == value
            Box(Modifier.weight(1f).height(28.dp).background(if (sel) K.AccentDim else Color.Transparent)
                .clickable(enabled = enabled) { onPick(v) }, contentAlignment = Alignment.Center) {
                T(label, 12, if (sel) K.Accent else if (enabled) K.Text else K.Faint, bold = sel, maxLines = 1)
            }
            if (i < options.size - 1) Box(Modifier.width(1.dp).height(28.dp).background(K.Line))
        }
    }
}

@Composable
fun Field(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, hint: String = "", ltr: Boolean = false, singleLine: Boolean = true, password: Boolean = false) {
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(K.Bg).border(1.dp, K.Line, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
        if (value.isEmpty()) T(hint, 12, K.Faint)
        BasicTextField(value, onChange, singleLine = singleLine, cursorBrush = SolidColor(K.Accent),
            textStyle = TextStyle(color = K.Text, fontSize = 13.sp, fontFamily = K.font, textAlign = if (ltr) TextAlign.Left else TextAlign.Start),
            visualTransformation = if (password) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            modifier = Modifier.fillMaxWidth())
    }
}

/** A labelled slider row with its value written beside it. */
@Composable
fun SliderRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, text: String, onChange: (Float) -> Unit) {
    Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
        T(label, 12, K.Dim, modifier = Modifier.width(64.dp))
        Slider(value, onChange, valueRange = range, modifier = Modifier.weight(1f).height(24.dp),
            colors = SliderDefaults.colors(thumbColor = K.Accent, activeTrackColor = K.Accent, inactiveTrackColor = K.Line))
        T(text, 12, K.Text, modifier = Modifier.width(52.dp), align = TextAlign.End)
    }
}

/** A small status capsule (top bar). */
@Composable
fun Pill(text: String, color: Color = K.Dim, dot: Color? = null) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(K.Raised).border(1.dp, K.Line, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (dot != null) { Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(dot)); Spacer(Modifier.width(6.dp)) }
        T(text, 12, color, maxLines = 1)
    }
}

fun clock(s: Long) = if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%02d:%02d".format(s / 60, s % 60)
