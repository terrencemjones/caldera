// Caldera launcher. The installer compiles this into Caldera.exe on the user's machine.
//
// It opens Caldera.html (which sits next to the exe) in a Chrome or Edge app window,
// with its own browser profile, and makes Windows treat that window as Caldera rather
// than as the browser: the window, this process and the shortcuts all carry the same
// AppUserModelID, so the taskbar groups them and pinning the running app works.
//
//   Caldera.exe                     start the app, or bring it forward if it is running
//   Caldera.exe --shortcut <path>   write a .lnk that points at this exe
//
// Written for the C# 5 compiler that ships with Windows; keep it to that language level.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using Microsoft.Win32;

static class Launcher
{
    const string AppName = "Caldera";
    const string AppId = "terrencemjones.Caldera";
    const string BrowserWindowClass = "Chrome_WidgetWin_1";

    static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static readonly string Exe = Process.GetCurrentProcess().MainModule.FileName;

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID(AppId);
            if (args.Length == 2 && args[0] == "--shortcut")
            {
                MakeShortcut(args[1]);
                return 0;
            }
            return Run();
        }
        catch (Exception e)
        {
            Fail(AppName + " could not start.\n\n" + e.Message, e.ToString());
            return 1;
        }
    }

    static int Run()
    {
        string html = Path.Combine(Dir, "Caldera.html");
        if (!File.Exists(html))
        {
            Fail(AppName + " is missing a file and cannot start:\n\n" + html + "\n\nRun the Caldera installer again.", null);
            return 1;
        }

        // Already running: bring that window forward instead of opening a second one.
        IntPtr open = FindWindow(0);
        if (open != IntPtr.Zero)
        {
            if (IsIconic(open)) ShowWindow(open, 9 /* SW_RESTORE */);
            SetForegroundWindow(open);
            return 0;
        }

        string browser = FindBrowser();
        if (browser == null)
        {
            Fail(AppName + " needs Google Chrome or Microsoft Edge, and neither was found on this computer.", null);
            return 1;
        }

        string arguments =
            "--app=\"" + new Uri(html).AbsoluteUri + "\"" +
            " --user-data-dir=\"" + Path.Combine(Dir, "profile") + "\"" +
            " --no-first-run --no-default-browser-check --start-maximized";
        ProcessStartInfo info = new ProcessStartInfo(browser, arguments);
        info.UseShellExecute = false;
        info.WorkingDirectory = Dir;
        Process process = Process.Start(info);

        // Wait for the browser to show its window, then label it as ours.
        for (int i = 0; i < 200; i++)
        {
            Thread.Sleep(100);
            IntPtr hwnd = FindWindow(process.Id);
            if (hwnd != IntPtr.Zero)
            {
                Stamp(hwnd);
                return 0;
            }
            if (process.HasExited) break;
        }
        Log("The browser started, but no window appeared to label. Browser: " + browser);
        return 0;
    }

    static string FindBrowser()
    {
        string[] names = { "chrome.exe", "msedge.exe" };
        foreach (string name in names)
        {
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (RegistryKey key = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name))
                {
                    string path = key == null ? null : key.GetValue(null) as string;
                    if (path != null && File.Exists(path)) return path;
                }
            }
        }
        string[] roots =
        {
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("LOCALAPPDATA"),
        };
        string[] tails = { @"Google\Chrome\Application\chrome.exe", @"Microsoft\Edge\Application\msedge.exe" };
        foreach (string tail in tails)
        {
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root)) continue;
                string path = Path.Combine(root, tail);
                if (File.Exists(path)) return path;
            }
        }
        return null;
    }

    /// <summary>
    /// Finds a visible top-level browser window. With a process id, the window must belong to
    /// that process; with 0, it must already carry our AppUserModelID.
    /// </summary>
    static IntPtr FindWindow(int pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused)
        {
            if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            StringBuilder cls = new StringBuilder(64);
            GetClassName(hwnd, cls, cls.Capacity);
            if (cls.ToString() != BrowserWindowClass) return true;
            if (GetWindowTextLength(hwnd) == 0) return true;
            if (pid != 0)
            {
                uint owner;
                GetWindowThreadProcessId(hwnd, out owner);
                if (owner != (uint)pid) return true;
            }
            else if (ReadAppId(hwnd) != AppId) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    // ---- AppUserModelID plumbing -------------------------------------------------------

    static PROPERTYKEY Key(uint pid)
    {
        PROPERTYKEY k = new PROPERTYKEY();
        k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); // System.AppUserModel.*
        k.pid = pid;
        return k;
    }

    const uint RelaunchCommand = 2, RelaunchIconResource = 3, RelaunchDisplayNameResource = 4, Id = 5;

    static IPropertyStore StoreFor(IntPtr hwnd)
    {
        Guid iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        int hr = SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
        return hr == 0 ? store : null;
    }

    static string ReadAppId(IntPtr hwnd)
    {
        IPropertyStore store = StoreFor(hwnd);
        if (store == null) return null;
        try
        {
            PROPERTYKEY key = Key(Id);
            PROPVARIANT value;
            if (store.GetValue(ref key, out value) != 0) return null;
            try { return value.vt == 31 /* VT_LPWSTR */ ? Marshal.PtrToStringUni(value.p) : null; }
            finally { PropVariantClear(ref value); }
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    static void Set(IPropertyStore store, uint pid, string text)
    {
        PROPERTYKEY key = Key(pid);
        PROPVARIANT value = new PROPVARIANT();
        value.vt = 31; // VT_LPWSTR
        value.p = Marshal.StringToCoTaskMemUni(text);
        try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); }
        finally { PropVariantClear(ref value); }
    }

    /// <summary>Tells Windows the browser window is Caldera, and how to start it again when pinned.</summary>
    static void Stamp(IntPtr hwnd)
    {
        IPropertyStore store = StoreFor(hwnd);
        if (store == null)
        {
            Log("Could not open the window's property store.");
            return;
        }
        try
        {
            Set(store, RelaunchCommand, "\"" + Exe + "\"");
            Set(store, RelaunchDisplayNameResource, AppName);
            Set(store, RelaunchIconResource, Exe + ",0");
            Set(store, Id, AppId);
        }
        catch (Exception e)
        {
            Log("Could not label the window: " + e);
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    static void MakeShortcut(string path)
    {
        IShellLinkW link = (IShellLinkW)new CShellLink();
        link.SetPath(Exe);
        link.SetWorkingDirectory(Dir);
        link.SetDescription(AppName + " landscape studio");
        link.SetIconLocation(Exe, 0);
        IPropertyStore store = (IPropertyStore)link;
        Set(store, Id, AppId);
        Marshal.ThrowExceptionForHR(store.Commit());
        ((IPersistFile)link).Save(path, true);
    }

    // ---- Failure reporting -------------------------------------------------------------

    static void Log(string text)
    {
        try
        {
            File.AppendAllText(Path.Combine(Dir, "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text + Environment.NewLine);
        }
        catch { }
    }

    static void Fail(string message, string detail)
    {
        Log(detail ?? message);
        MessageBoxW(IntPtr.Zero, message, AppName, 0x10 /* MB_ICONERROR */);
    }

    // ---- Interop -----------------------------------------------------------------------

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct PROPERTYKEY { public Guid fmtid; public uint pid; }

    // Matches PROPVARIANT's size on both 32-bit and 64-bit Windows; only strings are used.
    [StructLayout(LayoutKind.Sequential)]
    struct PROPVARIANT { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkW
    {
        void GetPath(IntPtr file, int max, IntPtr data, uint flags);
        void GetIDList(out IntPtr pidl);
        void SetIDList(IntPtr pidl);
        void GetDescription(IntPtr text, int max);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory(IntPtr dir, int max);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments(IntPtr args, int max);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out ushort key);
        void SetHotkey(ushort key);
        void GetShowCmd(out int show);
        void SetShowCmd(int show);
        void GetIconLocation(IntPtr path, int max, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr hwnd, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class CShellLink { }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    [DllImport("shell32.dll")]
    static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PROPVARIANT value);
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);
}
