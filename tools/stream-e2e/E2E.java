import com.vil3ntec.rawrec.RtmpSink;
import android.media.MediaFormat;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.*;

/** Feeds the app's own RtmpSink with real H.264 (5 renditions, switched at key frames as the encoder would on onBitrate), in real time. */
public class E2E {
    static List<byte[]> aus(byte[] d) {
        List<Integer> starts = new ArrayList<>();
        for (int i = 0; i + 4 < d.length; i++)
            if (d[i]==0 && d[i+1]==0 && d[i+2]==0 && d[i+3]==1 && (d[i+4] & 0x1F) == 9) starts.add(i);
        List<byte[]> out = new ArrayList<>();
        for (int k = 0; k < starts.size(); k++) out.add(Arrays.copyOfRange(d, starts.get(k), k+1 < starts.size() ? starts.get(k+1) : d.length));
        return out;
    }
    static byte[] nal(byte[] au, int type) {
        for (int i = 0; i + 4 < au.length; i++) if (au[i]==0 && au[i+1]==0 && au[i+2]==0 && au[i+3]==1 && (au[i+4] & 0x1F) == type) {
            int j = i + 4; while (j + 3 < au.length && !(au[j]==0 && au[j+1]==0 && (au[j+2]==1 || (au[j+2]==0 && au[j+3]==1)))) j++;
            if (j + 3 >= au.length) j = au.length;
            return Arrays.copyOfRange(au, i, j);
        }
        return null;
    }
    static boolean key(byte[] au) { for (int i = 0; i + 4 < au.length; i++) if (au[i]==0 && au[i+1]==0 && au[i+2]==1 && (au[i+3] & 0x1F) == 5) return true; return false; }

    public static void main(String[] a) throws Exception {
        String dir = a[0]; String url = a[1]; int seconds = Integer.parseInt(a[2]); boolean manual = a.length > 3 && a[3].equals("manual");
        int[] rates = {400, 800, 1500, 3000, 6000};
        Map<Integer, List<byte[]>> r = new TreeMap<>();
        for (int br : rates) r.put(br * 1000, aus(Files.readAllBytes(Paths.get(dir, "v" + br + ".h264"))));
        final int[] want = {6_000_000};
        final List<String> log = Collections.synchronizedList(new ArrayList<>());
        RtmpSink.Listener l = new RtmpSink.Listener() {
            String last = "";
            public void onStatus(RtmpSink.Status s) {
                ST = s;
                String line = s.getState() + " sent=" + s.getKbps() + " target=" + s.getTargetKbps() + " lag=" + s.getLagMs() + " dropped=" + s.getDropped() + " reconnects=" + s.getReconnects() + (s.getError() != null ? " err=" + s.getError() : "");
                if (!line.equals(last)) { last = line; }
            }
            public void onBitrate(int bps) { want[0] = bps; log.add(String.format("%.1fs encoder -> %d kbps", (System.nanoTime() - T0) / 1e9, bps / 1000)); }
        };
        byte[] first = r.get(6_000_000).get(0);
        MediaFormat f = MediaFormat.createVideoFormat("video/avc", 1280, 720);
        f.setInteger(MediaFormat.KEY_FRAME_RATE, 30);
        f.setByteBuffer("csd-0", ByteBuffer.wrap(nal(first, 7)));
        f.setByteBuffer("csd-1", ByteBuffer.wrap(nal(first, 8)));
        RtmpSink sink = new RtmpSink(url, "test", manual ? 6_000_000 : 6_000_000, l, !manual, 0);
        sink.dropAudio();
        sink.videoFormat(f);
        T0 = System.nanoTime();
        int n = seconds * 30; int cur = 6_000_000; int frames = r.get(6_000_000).size();
        long sentBytes = 0;
        for (int i = 0; i < n; i++) {
            if (i % 30 == 0) {   // the encoder takes a new rate at its next key frame
                int w = want[0]; int pick = 400_000; for (int br : r.keySet()) if (br <= w) pick = br; cur = pick;
            }
            byte[] au = r.get(cur).get(i % frames);
            boolean k = key(au);
            sentBytes += au.length;
            sink.submitVideo(ByteBuffer.wrap(au), 0, au.length, i * 33_333L, k ? android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME : 0);
            long due = T0 + (i + 1) * 33_333_333L;
            long w = due - System.nanoTime(); if (w > 0) Thread.sleep(w / 1_000_000, (int) (w % 1_000_000));
            if (i % 150 == 149) { RtmpSink.Status st = ST; System.out.println(String.format("t=%3ds encoder=%5d kbps | sent=%5d kbps target=%5d behind=%5d ms dropped=%d", (i + 1) / 30, cur / 1000, st == null ? 0 : st.getKbps(), st == null ? 0 : st.getTargetKbps(), st == null ? 0 : st.getLagMs(), sink.getDropped())); }
        }
        sink.finish();

        System.out.println("frames fed: " + n + "  dropped by sink: " + sink.getDropped() + "  reconnects: " + sink.getReconnects());
    }
    static long T0;
    static volatile RtmpSink.Status ST;
}
