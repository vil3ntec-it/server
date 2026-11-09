package com.vil3ntec.rawrec

import org.junit.Assert.assertEquals
import org.junit.Test

/** 7.9: 60 pictures a second by what the picture's size needs — so YouTube offers «1080p60», not «1080p». */
class FpsRuleTest {
    private fun level(prev: Int, kbps: Int, short: Int, fill: Int = 100) = LiveSettings.fpsLevel(prev, kbps, short, fill)

    @Test fun sixtyByWhatTheSizeNeeds() {
        // «1080p60, 12 Mbps» on a link that carries 7: until 7.8 this went at 30 (under 55 % of 12, back only at 9)
        assertEquals("1080p at 7 Mbps: 60", 0, level(0, 7000, 1080))
        assertEquals("1080p at 6 Mbps coming up from 30: 60 again", 0, level(1, 6000, 1080))
        assertEquals("1080p at 4 Mbps: 30, each picture twice the bits", 1, level(0, 4000, 1080))
        assertEquals("no flapping around the line: 5.5 stays at 60 …", 0, level(0, 5500, 1080))
        assertEquals("… and stays at 30 when it was at 30", 1, level(1, 5500, 1080))
        assertEquals("720p at 4.5 Mbps: 60 (until 7.8: 30 under 4.5 and back only at 5.5)", 0, level(0, 4500, 720))
        assertEquals("720p at 3 Mbps: 30", 1, level(0, 3000, 720))
        assertEquals("480p at 2.5 Mbps: 60", 0, level(1, 2500, 480))
    }

    @Test fun aQuietSceneKeepsEveryPicture() {
        // the rate sits low after a hiccup, the lobby fills a tenth of it: frames cost nothing — all of them
        assertEquals(0, level(0, 3000, 1080, fill = 10))
        assertEquals(0, level(1, 3000, 1080, fill = 40))
        // the fight fills the rate: 30 until the rate has climbed to what 1080p needs
        assertEquals(1, level(0, 3000, 1080, fill = 95))
    }
}
