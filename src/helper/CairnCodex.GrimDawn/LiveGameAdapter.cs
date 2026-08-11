using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CairnCodex.GrimDawn;

internal sealed class LiveGameAdapter : IDisposable
{
    private const int WmCopyData = 0x004A;
    private const int WmClose = 0x0010;
    private const int TypeWorkerLaunched = 3;
    private const int TypeHardcore = 20;
    private const int TypeHardcoreViaInit = 47;
    private const int TypeInjectionCancelled = 8100;
    private const string WindowClassName = "GDIAWindowClass";

    private readonly object sync = new();
    private readonly HashSet<string> incomingBaseline = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<LiveHookMessage> messages = [];
    private Thread? windowThread;
    private ManualResetEventSlim? windowReady;
    private WndProc? windowProcedure;
    private IntPtr window;
    private string? itemAssistantDirectory;
    private string? queueDirectory;
    private int? gameProcessId;
    private bool? isHardcore;
    private string state = "unavailable";
    private string detail = "Live mode has not been started.";
    private string? injectorOutput;

    public static LiveQueueSelfTestResult SelfTest()
    {
        var sample = new VaultItemPayload(
            11, -1, -1,
            "records/items/test.dbr", "records/prefix/test.dbr", "records/suffix/test.dbr",
            "records/modifier/test.dbr", "records/transmute/test.dbr", 4_000_000_001,
            "records/materia/test.dbr", "records/relic/test.dbr", 123,
            "records/enchantment/test.dbr", "records/ascendant/test.dbr", "records/ascendant/test2h.dbr",
            0, 456, 0, 1, 7, 9, 0, 0);
        var serialized = SerializeCsv(true, sample);
        var parsed = ParseCsv(Encoding.UTF8.GetBytes("\uFEFF" + serialized + "\n6;Sample tooltip"));
        var stable = SerializeCsv(parsed.IsHardcore, parsed.Item);
        if (!parsed.IsHardcore || parsed.Item != sample || serialized != stable || serialized.Split(';').Length != 17)
        {
            throw new InvalidDataException("The GDIA live queue serializer failed its round trip.");
        }
        return new LiveQueueSelfTestResult(true, 17, sample.Seed, sample.AffixRerolls);
    }

    public LiveGameStatus Inspect()
    {
        lock (sync)
        {
            var game = FindProcesses(["Grim Dawn", "GrimDawn"]);
            var itemAssistant = FindProcesses(["IAGrim"]);
            try
            {
                var install = ResolveItemAssistantDirectory();
                var hook = install is null ? null : Path.Combine(install, "ItemAssistantHook_x64.dll");
                var injector = install is null ? null : Path.Combine(install, "DllInjector64.exe");
                var compatible = hook is not null && injector is not null && File.Exists(hook) && File.Exists(injector);
                var queueSettings = ReadQueueSettings();
                var currentState = state;
                var currentDetail = detail;
                if (window == IntPtr.Zero)
                {
                    currentState = game.Count == 0 || !compatible ? "unavailable" : "available";
                    currentDetail = game.Count == 0
                        ? "Start Grim Dawn and enter the world before enabling live mode."
                        : !compatible
                            ? "A compatible Grim Dawn Item Assistant hook installation was not found."
                            : itemAssistant.Count > 0
                                ? "Close Item Assistant before Cairn Codex owns the live queue."
                                : "Compatible game process and GDIA hook found. Live mode is ready to connect.";
                }
                return new LiveGameStatus(
                    currentState,
                    currentDetail,
                    game.Select(process => process.Id).ToArray(),
                    itemAssistant.Select(process => process.Id).ToArray(),
                    compatible,
                    install,
                    hook is null || !File.Exists(hook) ? null : FileVersionInfo.GetVersionInfo(hook).FileVersion,
                    gameProcessId,
                    isHardcore,
                    queueSettings.LootFrom,
                    queueSettings.DepositTo,
                    queueSettings.LootDescription,
                    queueSettings.DepositDescription,
                    window != IntPtr.Zero,
                    injectorOutput,
                    messages.TakeLast(20).ToArray());
            }
            finally
            {
                foreach (var process in game) process.Dispose();
                foreach (var process in itemAssistant) process.Dispose();
            }
        }
    }

    public LiveGameStatus Start()
    {
        lock (sync)
        {
            if (window != IntPtr.Zero)
            {
                return Inspect();
            }
            var itemAssistant = FindProcesses(["IAGrim"]);
            if (itemAssistant.Count > 0)
            {
                foreach (var process in itemAssistant) process.Dispose();
                throw new WriteSafetyException(
                    "Close Grim Dawn Item Assistant before enabling Cairn Codex live mode.");
            }
            foreach (var process in itemAssistant) process.Dispose();
            var game = FindProcesses(["Grim Dawn", "GrimDawn"]);
            if (game.Count != 1)
            {
                foreach (var process in game) process.Dispose();
                throw new WriteSafetyException(
                    game.Count == 0
                        ? "Start Grim Dawn and enter the world before enabling live mode."
                        : "Live mode requires exactly one Grim Dawn process.");
            }
            itemAssistantDirectory = ResolveItemAssistantDirectory()
                ?? throw new FileNotFoundException("Grim Dawn Item Assistant is not installed.");
            var hook = Path.Combine(itemAssistantDirectory, "ItemAssistantHook_x64.dll");
            var injector = Path.Combine(itemAssistantDirectory, "DllInjector64.exe");
            if (!File.Exists(hook) || !File.Exists(injector))
            {
                throw new FileNotFoundException("The installed GDIA hook or injector is missing.");
            }
            queueDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EvilSoft", "IAGD", "itemqueue");
            var incoming = Path.Combine(queueDirectory, "ingoing");
            Directory.CreateDirectory(incoming);
            incomingBaseline.Clear();
            foreach (var path in Directory.EnumerateFiles(incoming, "*.csv"))
            {
                incomingBaseline.Add(Path.GetFullPath(path));
            }
            messages.Clear();
            isHardcore = null;
            gameProcessId = game[0].Id;
            state = "connecting";
            detail = "Creating the live hook handshake window.";
            StartWindow();
            SignalHookWorker();

            if (!ProcessHasModule(game[0], hook))
            {
                var start = new ProcessStartInfo
                {
                    FileName = injector,
                    WorkingDirectory = itemAssistantDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                start.ArgumentList.Add("-t");
                start.ArgumentList.Add("1");
                start.ArgumentList.Add("Grim Dawn.exe");
                start.ArgumentList.Add(hook);
                using var injection = Process.Start(start)
                    ?? throw new InvalidOperationException("The GDIA injector did not start.");
                if (!injection.WaitForExit(5000))
                {
                    try { injection.Kill(); } catch { }
                    throw new IOException("The GDIA injector did not finish within five seconds.");
                }
                injectorOutput = (injection.StandardOutput.ReadToEnd() + " " +
                    injection.StandardError.ReadToEnd()).Trim();
                if (injection.ExitCode != 0)
                {
                    throw new IOException(
                        $"The GDIA injector failed with exit code {injection.ExitCode}: {injectorOutput}");
                }
            }

            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                if (ProcessHasModule(game[0], hook))
                {
                    state = "ready";
                    detail = "Live hook connected. Open the shared stash to ingest or retrieve items.";
                    foreach (var process in game) process.Dispose();
                    return Inspect();
                }
                Thread.Sleep(100);
            }
            state = "connecting";
            detail = messages.Any(message => message.Type == TypeInjectionCancelled)
                ? "The hook deferred injection because the character world is not ready. Enter the world and retry."
                : "Injection was requested but the hook has not completed its handshake yet.";
            foreach (var process in game) process.Dispose();
            return Inspect();
        }
    }

    public IReadOnlyList<LiveIncomingItem> PollIncoming()
    {
        lock (sync)
        {
            DemandReady();
            var incoming = Path.Combine(queueDirectory!, "ingoing");
            var result = new List<LiveIncomingItem>();
            foreach (var path in Directory.EnumerateFiles(incoming, "*.csv")
                         .OrderBy(path => File.GetCreationTimeUtc(path)))
            {
                var fullPath = Path.GetFullPath(path);
                if (incomingBaseline.Contains(fullPath)) continue;
                byte[] bytes;
                try
                {
                    bytes = ReadStable(fullPath);
                }
                catch (IOException)
                {
                    continue;
                }
                var payload = ParseCsv(bytes);
                result.Add(new LiveIncomingItem(
                    fullPath,
                    Convert.ToHexStringLower(SHA256.HashData(bytes)),
                    payload.IsHardcore,
                    payload.Item,
                    File.GetCreationTimeUtc(fullPath).ToString("O")));
            }
            return result;
        }
    }

    public LiveQueueReceipt AcknowledgeIncoming(string path, string expectedSha256, string receiptDirectory)
    {
        lock (sync)
        {
            DemandReady();
            var fullPath = ValidateIncomingPath(path);
            var bytes = ReadStable(fullPath);
            var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
            if (!hash.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new SourceChangedException("The live incoming item changed before acknowledgement.");
            }
            Directory.CreateDirectory(receiptDirectory);
            var target = Path.Combine(receiptDirectory, $"{hash}.{Path.GetFileName(fullPath)}");
            if (File.Exists(target)) File.Delete(fullPath);
            else File.Move(fullPath, target);
            incomingBaseline.Add(fullPath);
            return new LiveQueueReceipt(hash, target);
        }
    }

    public LiveQueueReceipt CopyIncomingReceipt(string path, string expectedSha256, string receiptDirectory)
    {
        lock (sync)
        {
            DemandReady();
            var fullPath = ValidateIncomingPath(path);
            var bytes = ReadStable(fullPath);
            var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
            if (!hash.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new SourceChangedException("The live incoming item changed before it was archived.");
            }
            Directory.CreateDirectory(receiptDirectory);
            var target = Path.Combine(receiptDirectory, $"{hash}.{Path.GetFileName(fullPath)}");
            if (!File.Exists(target))
            {
                var temporary = target + ".tmp";
                File.WriteAllBytes(temporary, bytes);
                File.Move(temporary, target);
            }
            var copiedHash = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(target)));
            if (!copiedHash.Equals(hash, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("The copied live receipt failed hash verification.");
            }
            return new LiveQueueReceipt(hash, target);
        }
    }

    public LiveRetrievalQueue EnqueueRetrieval(
        string operationId,
        bool isHardcore,
        VaultItemPayload item)
    {
        lock (sync)
        {
            DemandReady();
            if (this.isHardcore is not null && this.isHardcore != isHardcore)
            {
                throw new WriteSafetyException(
                    $"The running character is {(this.isHardcore == true ? "Hardcore" : "Softcore")}, " +
                    $"but the selected vault item is {(isHardcore ? "Hardcore" : "Softcore")}.");
            }
            var outgoing = Path.Combine(queueDirectory!, "outgoing", isHardcore ? "hc" : "sc");
            var deleted = Path.Combine(queueDirectory!, "deleted", isHardcore ? "hc" : "sc");
            var incoming = Path.Combine(queueDirectory!, "ingoing");
            Directory.CreateDirectory(outgoing);
            Directory.CreateDirectory(deleted);
            Directory.CreateDirectory(incoming);
            var bytes = Encoding.UTF8.GetBytes(SerializeCsv(isHardcore, item));
            var semanticHash = Convert.ToHexStringLower(SHA256.HashData(bytes));
            var baselineDeleted = MatchingFiles(deleted, semanticHash);
            var baselineIncoming = MatchingFiles(incoming, semanticHash);
            var filename = $"cairn-{operationId}.csv";
            var target = Path.Combine(outgoing, filename);
            var temporary = target + ".tmp";
            File.WriteAllBytes(temporary, bytes);
            File.Move(temporary, target, true);
            return new LiveRetrievalQueue(
                operationId,
                target,
                semanticHash,
                isHardcore,
                baselineDeleted,
                baselineIncoming);
        }
    }

    public LiveRetrievalStatus InspectRetrieval(LiveRetrievalQueue queue)
    {
        lock (sync)
        {
            DemandReady();
            if (File.Exists(queue.OutgoingPath))
            {
                return new LiveRetrievalStatus("pending", null);
            }
            var deleted = Path.Combine(queueDirectory!, "deleted", queue.IsHardcore ? "hc" : "sc");
            var deposited = MatchingFiles(deleted, queue.SemanticSha256)
                .Except(queue.BaselineDeleted, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
            if (deposited is not null)
            {
                return new LiveRetrievalStatus("deposited", deposited);
            }
            var incoming = Path.Combine(queueDirectory!, "ingoing");
            var rejected = MatchingFiles(incoming, queue.SemanticSha256)
                .Except(queue.BaselineIncoming, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
            return rejected is null
                ? new LiveRetrievalStatus("unknown", null)
                : new LiveRetrievalStatus("rejected", rejected);
        }
    }

    private void DemandReady()
    {
        if (state != "ready" || window == IntPtr.Zero || queueDirectory is null)
        {
            throw new WriteSafetyException("The live-game adapter is not ready.");
        }
        var itemAssistant = FindProcesses(["IAGrim"]);
        try
        {
            if (itemAssistant.Count > 0)
            {
                throw new WriteSafetyException("Item Assistant started after live mode; queue ownership is blocked.");
            }
        }
        finally
        {
            foreach (var process in itemAssistant) process.Dispose();
        }
    }

    private static LiveCsvPayload ParseCsv(byte[] bytes)
    {
        var firstLine = Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF')
            .Split(['\r', '\n'], 2)[0];
        var fields = firstLine.Split(';');
        if (fields.Length != 17)
        {
            throw new InvalidDataException($"Expected 17 live item fields, found {fields.Length}.");
        }
        static uint Number(string value) => uint.TryParse(value, out var parsed) ? parsed : 0;
        var item = new VaultItemPayload(
            11, -1, -1,
            fields[2].Trim(), fields[3].Trim(), fields[4].Trim(), fields[7].Trim(),
            fields[13].Trim(), Number(fields[5]), fields[8].Trim(), fields[9].Trim(),
            Number(fields[10]), fields[11].Trim(), fields[14].Trim(), fields[15].Trim(),
            0, Number(fields[12]), 0, 1, Number(fields[6]), Number(fields[16]), 0, 0);
        if (string.IsNullOrWhiteSpace(item.BaseRecord))
        {
            throw new InvalidDataException("The live item has no base record.");
        }
        return new LiveCsvPayload(fields[1] == "1", item);
    }

    private static string SerializeCsv(bool isHardcore, VaultItemPayload item) => string.Join(';',
        "",
        isHardcore ? "1" : "0",
        item.BaseRecord,
        item.PrefixRecord,
        item.SuffixRecord,
        item.Seed,
        item.Rerolls,
        item.ModifierRecord,
        item.MateriaRecord,
        item.RelicCompletionBonusRecord,
        item.RelicSeed,
        item.EnchantmentRecord,
        item.EnchantmentSeed,
        item.TransmuteRecord,
        item.AscendantRecord,
        item.AscendantRecord2H,
        item.AffixRerolls);

    private string ValidateIncomingPath(string path)
    {
        var root = Path.GetFullPath(Path.Combine(queueDirectory!, "ingoing")) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(path);
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
            !fullPath.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
        {
            throw new UnauthorizedAccessException("Live acknowledgement path is outside the incoming queue.");
        }
        return fullPath;
    }

    private static byte[] ReadStable(string path)
    {
        var before = new FileInfo(path);
        byte[] bytes;
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            bytes = new byte[stream.Length];
            stream.ReadExactly(bytes);
        }
        var after = new FileInfo(path);
        if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc)
        {
            throw new IOException("Live queue item changed while it was being read.");
        }
        return bytes;
    }

    private static IReadOnlyList<string> MatchingFiles(string directory, string semanticHash)
    {
        if (!Directory.Exists(directory)) return [];
        var result = new List<string>();
        foreach (var path in Directory.EnumerateFiles(directory, "*.csv"))
        {
            try
            {
                var payload = ParseCsv(ReadStable(path));
                var bytes = Encoding.UTF8.GetBytes(SerializeCsv(payload.IsHardcore, payload.Item));
                if (Convert.ToHexStringLower(SHA256.HashData(bytes)) == semanticHash)
                {
                    result.Add(Path.GetFullPath(path));
                }
            }
            catch { }
        }
        return result;
    }

    private void StartWindow()
    {
        windowReady = new ManualResetEventSlim(false);
        windowProcedure = WindowProc;
        windowThread = new Thread(() =>
        {
            var instance = GetModuleHandle(null);
            var windowClass = new WndClassEx
            {
                Size = (uint)Marshal.SizeOf<WndClassEx>(),
                Instance = instance,
                ClassName = WindowClassName,
                WindowProcedure = Marshal.GetFunctionPointerForDelegate(windowProcedure)
            };
            var atom = RegisterClassEx(ref windowClass);
            if (atom == 0 && Marshal.GetLastWin32Error() != 1410)
            {
                windowReady.Set();
                return;
            }
            window = CreateWindowEx(
                0, WindowClassName, "Cairn Codex live host", 0,
                0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
            windowReady.Set();
            if (window == IntPtr.Zero) return;
            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
            window = IntPtr.Zero;
        }) { IsBackground = true, Name = "CairnCodex.LiveWindow" };
        windowThread.SetApartmentState(ApartmentState.STA);
        windowThread.Start();
        if (!windowReady.Wait(TimeSpan.FromSeconds(3)) || window == IntPtr.Zero)
        {
            throw new IOException("Could not create the GDIA live handshake window.");
        }
    }

    private IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WmCopyData)
        {
            var copy = Marshal.PtrToStructure<CopyDataStruct>(lParam);
            var type = unchecked((int)copy.DataType.ToInt64());
            var data = copy.ByteCount > 0 && copy.Data != IntPtr.Zero
                ? ReadBytes(copy.Data, copy.ByteCount)
                : [];
            lock (sync)
            {
                messages.Add(new LiveHookMessage(type, Convert.ToHexStringLower(data), DateTime.UtcNow.ToString("O")));
                if ((type == TypeHardcore || type == TypeHardcoreViaInit) && data.Length > 0)
                {
                    isHardcore = data[0] != 0;
                }
                if (type == TypeWorkerLaunched)
                {
                    state = "ready";
                    detail = "Live hook worker handshake received.";
                }
                if (type == TypeInjectionCancelled)
                {
                    state = "connecting";
                    detail = "The game world is not ready for hook injection yet.";
                }
            }
            return IntPtr.Zero;
        }
        if (message == WmClose)
        {
            DestroyWindow(hwnd);
            PostQuitMessage(0);
            return IntPtr.Zero;
        }
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    private static byte[] ReadBytes(IntPtr source, int length)
    {
        var bytes = new byte[length];
        Marshal.Copy(source, bytes, 0, length);
        return bytes;
    }

    private static List<Process> FindProcesses(IEnumerable<string> names)
    {
        var result = new Dictionary<int, Process>();
        foreach (var name in names)
        {
            foreach (var process in Process.GetProcessesByName(name)) result[process.Id] = process;
        }
        return result.Values.OrderBy(process => process.Id).ToList();
    }

    private static bool ProcessHasModule(Process process, string modulePath)
    {
        try
        {
            return process.Modules.Cast<ProcessModule>().Any(module =>
                module.FileName.Equals(modulePath, StringComparison.OrdinalIgnoreCase));
        }
        catch { return false; }
    }

    private static string? ResolveItemAssistantDirectory()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "IAGD"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "IAGD")
        };
        return candidates.FirstOrDefault(path =>
            File.Exists(Path.Combine(path, "ItemAssistantHook_x64.dll")) &&
            File.Exists(Path.Combine(path, "DllInjector64.exe")));
    }

    private static LiveQueueSettings ReadQueueSettings()
    {
        try
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EvilSoft", "IAGD", "settings.json");
            using var document = JsonDocument.Parse(File.ReadAllBytes(path));
            var local = document.RootElement.GetProperty("local");
            var loot = local.TryGetProperty("stashToLootFrom", out var lootValue) ? lootValue.GetInt32() : 0;
            var deposit = local.TryGetProperty("stashToDepositTo", out var depositValue) ? depositValue.GetInt32() : 0;
            return new LiveQueueSettings(
                loot,
                deposit,
                loot == 0 ? "final shared stash tab" : $"shared stash tab {loot}",
                deposit == 0 ? "second-to-last shared stash tab" : $"shared stash tab {deposit}");
        }
        catch
        {
            return new LiveQueueSettings(0, 0, "final shared stash tab", "second-to-last shared stash tab");
        }
    }

    public void Dispose()
    {
        var hwnd = window;
        if (hwnd != IntPtr.Zero) PostMessage(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero);
        windowThread?.Join(TimeSpan.FromSeconds(2));
        // The injected hook caches whether the GDIA host window exists. Wake its named
        // worker event after our window is gone so it immediately observes the disconnect
        // and disables interception rather than waiting for another in-game event.
        SignalHookWorker();
        Thread.Sleep(150);
        windowReady?.Dispose();
        foreach (var process in FindProcesses(["Grim Dawn", "GrimDawn", "IAGrim"])) process.Dispose();
    }

    private static void SignalHookWorker()
    {
        var workerEvent = OpenEvent(0x0002, false, "IA_Worker");
        if (workerEvent == IntPtr.Zero) return;
        try { SetEvent(workerEvent); }
        finally { CloseHandle(workerEvent); }
    }

    private sealed record LiveCsvPayload(bool IsHardcore, VaultItemPayload Item);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint Size;
        public uint Style;
        public IntPtr WindowProcedure;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public string? MenuName;
        public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CopyDataStruct
    {
        public IntPtr DataType;
        public int ByteCount;
        public IntPtr Data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Value;
        public IntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X;
        public int Y;
        public uint Private;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WndClassEx windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
        uint extendedStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr hwnd, uint minimum, uint maximum);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenEvent(uint desiredAccess, bool inheritHandle, string name);

    [DllImport("kernel32.dll")]
    private static extern bool SetEvent(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}

internal sealed record LiveHookMessage(int Type, string DataHex, string ReceivedAtUtc);
internal sealed record LiveQueueSelfTestResult(bool Passed, int Fields, uint Seed, uint AffixRerolls);
internal sealed record LiveQueueSettings(
    int LootFrom,
    int DepositTo,
    string LootDescription,
    string DepositDescription);

internal sealed record LiveGameStatus(
    string State,
    string Detail,
    IReadOnlyList<int> GrimDawnProcessIds,
    IReadOnlyList<int> ItemAssistantProcessIds,
    bool HookAvailable,
    string? ItemAssistantDirectory,
    string? HookVersion,
    int? ConnectedProcessId,
    bool? IsHardcore,
    int IngestTabSetting,
    int DepositTabSetting,
    string IngestTabDescription,
    string DepositTabDescription,
    bool HostWindowReady,
    string? InjectorOutput,
    IReadOnlyList<LiveHookMessage> Messages);

internal sealed record LiveIncomingItem(
    string Path,
    string Sha256,
    bool IsHardcore,
    VaultItemPayload Item,
    string CreatedAtUtc);

internal sealed record LiveQueueReceipt(string Sha256, string ReceiptPath);

internal sealed record LiveRetrievalQueue(
    string OperationId,
    string OutgoingPath,
    string SemanticSha256,
    bool IsHardcore,
    IReadOnlyList<string> BaselineDeleted,
    IReadOnlyList<string> BaselineIncoming);

internal sealed record LiveRetrievalStatus(string State, string? ReceiptPath);
