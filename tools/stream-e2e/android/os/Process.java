package android.os;
/** JVM stand-in for the test harness: thread priority is the OS's business on a phone, a no-op here. */
public class Process {
    public static final int THREAD_PRIORITY_URGENT_AUDIO = -19;
    public static final int THREAD_PRIORITY_URGENT_DISPLAY = -8;
    public static void setThreadPriority(int p) {}
    public static void setThreadPriority(int tid, int p) {}
    public static int myTid() { return 0; }
}
