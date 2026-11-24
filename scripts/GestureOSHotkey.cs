using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class GestureOSHotkey
{
    private const uint Alt = 0x0001, Control = 0x0002, Shift = 0x0004, Win = 0x0008, NoRepeat = 0x4000;
    private const uint F23 = 0x86, C = 0x43, HotkeyMessage = 0x0312;
    private const int RightAlt = 0xA5;
    private const int F23Hotkey = 1, WinCHotkey = 2, AltGrF23Hotkey = 3, AltGrWinCHotkey = 4;

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || !File.Exists(args[0]))
                throw new FileNotFoundException("Pass the path to the built gestureos.exe.");

            bool useWinC = Array.IndexOf(args, "--win-c") >= 0;
            bool checkOnly = Array.IndexOf(args, "--check") >= 0;
            using (var mutex = new Mutex(false, @"Local\GestureOS.CopilotHotkey"))
            {
                try
                {
                    if (!mutex.WaitOne(0)) return checkOnly ? 2 : 0;
                }
                catch (AbandonedMutexException) { }

                try
                {
                    uint modifiers = Alt | Win | NoRepeat;
                    bool f23Registered = !useWinC && RegisterHotKey(IntPtr.Zero, F23Hotkey, modifiers | Shift, F23);
                    bool winCRegistered = RegisterHotKey(IntPtr.Zero, WinCHotkey, modifiers, C);
                    // On AltGr layouts Windows can add Ctrl to the physical right Alt key.
                    bool altGrF23Registered = !useWinC && RegisterHotKey(IntPtr.Zero, AltGrF23Hotkey, modifiers | Control | Shift, F23);
                    bool altGrWinCRegistered = RegisterHotKey(IntPtr.Zero, AltGrWinCHotkey, modifiers | Control, C);
                    bool supportsF23 = f23Registered || altGrF23Registered;
                    bool supportsWinC = winCRegistered || altGrWinCRegistered;
                    if (!supportsF23 && !supportsWinC)
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not register Right Alt + Copilot.");

                    try
                    {
                        if (checkOnly) return useWinC || (supportsF23 && supportsWinC) ? 0 : (supportsF23 ? 3 : 4);
                        Message message;
                        int result;
                        while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0)
                        {
                            if (message.Id != HotkeyMessage || GetAsyncKeyState(RightAlt) >= 0) continue;
                            ulong hotkey = message.WParam.ToUInt64();
                            if (hotkey != F23Hotkey && hotkey != WinCHotkey &&
                                hotkey != AltGrF23Hotkey && hotkey != AltGrWinCHotkey) continue;
                            try { OpenGestureOS(Path.GetFullPath(args[0])); }
                            catch (Exception error) { ShowError(error.Message); }
                        }
                        if (result == -1) throw new Win32Exception(Marshal.GetLastWin32Error());
                        return 0;
                    }
                    finally
                    {
                        if (f23Registered) UnregisterHotKey(IntPtr.Zero, F23Hotkey);
                        if (winCRegistered) UnregisterHotKey(IntPtr.Zero, WinCHotkey);
                        if (altGrF23Registered) UnregisterHotKey(IntPtr.Zero, AltGrF23Hotkey);
                        if (altGrWinCRegistered) UnregisterHotKey(IntPtr.Zero, AltGrWinCHotkey);
                    }
                }
                finally { mutex.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            if (Array.IndexOf(args, "--check") < 0) ShowError(error.Message);
            return 1;
        }
    }

    private static void OpenGestureOS(string path)
    {
        foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(path)))
        {
            using (process)
            {
                try
                {
                    if (!String.Equals(process.MainModule.FileName, path, StringComparison.OrdinalIgnoreCase))
                        continue;

                    int processId = process.Id;
                    IntPtr mainWindow = IntPtr.Zero;
                    var title = new StringBuilder(64);
                    EnumWindows(delegate(IntPtr window, IntPtr state)
                    {
                        uint owner;
                        GetWindowThreadProcessId(window, out owner);
                        if (owner != (uint)processId) return true;
                        GetWindowText(window, title, title.Capacity);
                        if (title.ToString() != "GestureOS") return true;

                        mainWindow = window;
                        return false;
                    }, IntPtr.Zero);

                    if (mainWindow != IntPtr.Zero)
                    {
                        ShowWindowAsync(mainWindow, IsIconic(mainWindow) ? 9 : 5);
                        SetForegroundWindow(mainWindow);
                    }
                    return;
                }
                catch (InvalidOperationException) { /* The app has just exited. */ }
                catch (Win32Exception)
                {
                    // Do not start a second copy if Windows prevents inspection of this process.
                    if (!process.HasExited) return;
                }
            }
        }

        using (Process.Start(new ProcessStartInfo(path) {
            WorkingDirectory = Path.GetDirectoryName(path),
            UseShellExecute = false
        })) { }
    }

    private static void ShowError(string message)
    {
        MessageBox(IntPtr.Zero, message, "GestureOS Hotkey", 0x10);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X;
        public int Y;
        public uint PrivateData;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder title, int capacity);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBox(IntPtr owner, string text, string caption, uint type);
}
