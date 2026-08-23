using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CairnCodex.GrimDawn;

internal sealed class LiveGameAdapter : IDisposable
{
    private const int WmCopyData = 0x004A;
    private const int WmClose = 0x0010;
    private const int TypeWorkerLaunched = 3;
    private const int TypeHardcore = 20;
    private const int TypeHardcoreViaInit = 47;
    private const int TypeInjectionCancelled = 8100;
    private const int TypeActiveCharacter = 8201;
    private const string WindowClassName = "GDIAWindowClass";
    private const string CrashingRetailHookSha256 =
        "14e57644d5403819aebfb856053f28afbc40dcdc2d95d0d9a8c71eafdf707891";
    private const string VerifiedRetailHookSha256 =
        "b553e19d825caaacc45c9b6f37e1dad7fcf2f2e4cc5b809186b0d871c89cc505";
    private const string VerifiedInjectorSha256 =
        "569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c";
    private static readonly IReadOnlyDictionary<string, string> VerifiedRetailGameDlls =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["d91c184b65ace035672403a00eb7ba4f67dc506e635b6090d77c1d54b91e48d7"] = "v1.3.0.6",
            // Steam build 24742013. Keep this exact fingerprint fail-closed when
            // the next Grim Dawn update replaces Game.dll.
            ["4a746c1e455d30e4c95a591eeead77f03d6187cd66aa1e3191ee25fb25a419aa"] = "v1.3.0.7",
            // Silent same-version Steam rebuild 24825149, deployed 2026-08-19.
            ["07775a297050e84a846af1182731700614fb8b7bb41cca46b37fd24c90529387"] =
                "v1.3.0.7 (Steam build 24825149)"
        };

    private readonly object sync = new();
    private readonly List<LiveHookMessage> messages = [];
    private Thread? windowThread;
    private ManualResetEventSlim? windowReady;
    private WndProc? windowProcedure;
    private IntPtr window;
    private string? adapterDirectory;
    private string? hookPath;
    private string? queueDirectory;
    private int? gameProcessId;
    private bool? isHardcore;
    private string? activeCharacterName;
    private int? compatibilityProcessId;
    private string? compatibilityHookPath;
    private LiveHookCompatibility? cachedCompatibility;
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
            0, 456, 0, 20, 7, 9, 0, 0);
        var serialized = SerializeCsv(true, sample);
        var parsed = ParseCsv(Encoding.UTF8.GetBytes("\uFEFF" + serialized + "\n6;Sample tooltip"));
        var stable = SerializeCsv(parsed.IsHardcore, parsed.Item);
        if (!parsed.IsHardcore || parsed.Item != sample || serialized != stable || serialized.Split(';').Length != 18)
        {
            throw new InvalidDataException("The Cairn live queue serializer failed its round trip.");
        }
        var receiptPath = Path.Combine(Path.GetTempPath(), $"cairn-live-receipt-{Guid.NewGuid():N}.csv");
        try
        {
            var receiptBytes = Encoding.UTF8.GetBytes(serialized);
            var semanticHash = Convert.ToHexStringLower(SHA256.HashData(receiptBytes));
            File.WriteAllBytes(receiptPath, receiptBytes);
            if (!FileMatchesSemanticHash(receiptPath, semanticHash))
            {
                throw new InvalidDataException("The Cairn live receipt did not match its operation payload.");
            }
            File.WriteAllText(receiptPath, serialized.Replace("records/items/test.dbr", "records/items/other.dbr"));
            if (FileMatchesSemanticHash(receiptPath, semanticHash))
            {
                throw new InvalidDataException("The Cairn live receipt accepted a different operation payload.");
            }
        }
        finally
        {
            File.Delete(receiptPath);
        }
        var adapter = ResolveAdapterDirectory()
            ?? throw new FileNotFoundException("The bundled Cairn live adapter is incomplete.");
        var hookHash = Convert.ToHexStringLower(SHA256.HashData(
            File.ReadAllBytes(Path.Combine(adapter, "ItemAssistantHook_x64.dll"))));
        var injectorHash = Convert.ToHexStringLower(SHA256.HashData(
            File.ReadAllBytes(Path.Combine(adapter, "DllInjector64.exe"))));
        if (hookHash != VerifiedRetailHookSha256 || injectorHash != VerifiedInjectorSha256)
        {
            throw new InvalidDataException("The bundled Cairn live adapter failed fingerprint verification.");
        }
        return new LiveQueueSelfTestResult(
            true, 18, sample.Seed, sample.AffixRerolls, hookHash, injectorHash);
    }

    public LiveGameStatus Inspect()
    {
        lock (sync)
        {
            var game = FindProcesses(["Grim Dawn", "GrimDawn"]);
            var itemAssistant = FindProcesses(["IAGrim"]);
            try
            {
                var install = ResolveAdapterDirectory();
                var hook = install is null ? null : Path.Combine(install, "ItemAssistantHook_x64.dll");
                var injector = install is null ? null : Path.Combine(install, "DllInjector64.exe");
                var filesPresent = hook is not null && injector is not null && File.Exists(hook) && File.Exists(injector);
                var compatibility = game.Count == 1 && filesPresent
                    ? GetCompatibility(game[0], hook!)
                    : new LiveHookCompatibility(false, null);
                var compatible = filesPresent && compatibility.Verified;
                var queueSettings = ReadQueueSettings();
                var currentState = state;
                var currentDetail = detail;
                if (window != IntPtr.Zero &&
                    (gameProcessId is null || game.All(process => process.Id != gameProcessId)))
                {
                    state = "blocked";
                    detail = "The connected Grim Dawn process exited. Live queue operations are locked.";
                    gameProcessId = null;
                    isHardcore = null;
                    currentState = state;
                    currentDetail = detail;
                }
                if (window == IntPtr.Zero)
                {
                    currentState = game.Count == 0 || !compatible ? "unavailable" : "available";
                    currentDetail = game.Count == 0
                        ? "Start Grim Dawn and enter the world before enabling live mode."
                        : !filesPresent
                            ? "The bundled Cairn Codex live adapter is incomplete."
                            : !compatible
                                ? compatibility.Reason ?? "This game and hook combination has not been verified for live transfers."
                            : itemAssistant.Count > 0
                                ? "Close Item Assistant before Cairn Codex owns the live queue."
                                : "Compatible game process and Cairn live adapter found. Live mode is ready to connect.";
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
                    activeCharacterName,
                    queueSettings.LootFrom,
                    queueSettings.DepositTo,
                    queueSettings.LootDescription,
                    queueSettings.DepositDescription,
                    window != IntPtr.Zero,
                    injectorOutput,
                    messages.TakeLast(20).ToArray(),
                    compatibility.GameVersion,
                    compatibility.GameBuildId,
                    compatibility.GameDllSha256,
                    compatibility.GameDllLastWriteUtc,
                    compatibility.HookSha256,
                    compatibility.Recommendation);
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
        if (window != IntPtr.Zero)
        {
            bool injectionWasDeferred;
            lock (sync)
            {
                injectionWasDeferred = state == "connecting" &&
                    messages.Any(message => message.Type == TypeInjectionCancelled);
            }
            if (!injectionWasDeferred) return Inspect();

            // The hook can be injected before Grim Dawn has published its game-engine
            // pointer. It then unloads cleanly, but the Cairn handshake window remains.
            // Tear down that stale attempt so a manual or automatic retry performs a
            // real injection after the character enters the world.
            StopConnection();
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
            adapterDirectory = ResolveAdapterDirectory()
                ?? throw new FileNotFoundException("The bundled Cairn Codex live adapter is incomplete.");
            var hook = Path.Combine(adapterDirectory, "ItemAssistantHook_x64.dll");
            var injector = Path.Combine(adapterDirectory, "DllInjector64.exe");
            if (!File.Exists(hook) || !File.Exists(injector))
            {
                throw new FileNotFoundException("The bundled Cairn hook or injector is missing.");
            }
            var compatibility = GetCompatibility(game[0], hook);
            if (!compatibility.Verified)
            {
                foreach (var process in game) process.Dispose();
                throw new WriteSafetyException(compatibility.Reason ??
                    "This game and hook combination has not been verified for live transfers.");
            }
            EnsureLiveSettings();
            queueDirectory = Path.Combine(LiveDataDirectory(), "itemqueue");
            var incoming = Path.Combine(queueDirectory, "ingoing");
            Directory.CreateDirectory(incoming);
            messages.Clear();
            isHardcore = null;
            hookPath = hook;
            gameProcessId = game[0].Id;
            state = "connecting";
            detail = "Creating the live hook handshake window.";
            StartWindow();
            var existingHook = ProcessHasModule(game[0], hook);
            // The upstream worker caches its last host-window lookup for one second.
            // Wait out that cache before waking it so a newly-created Cairn window
            // replaces a stale handle from a previous app process.
            if (existingHook) Thread.Sleep(1100);
            var existingWorker = existingHook && SignalHookWorker();

            if (existingWorker)
            {
                state = "ready";
                detail = "Reconnected to the existing verified live hook.";
                foreach (var process in game) process.Dispose();
                return Inspect();
            }

            if (!ProcessHasModule(game[0], hook))
            {
                var start = new ProcessStartInfo
                {
                    FileName = injector,
                    WorkingDirectory = adapterDirectory,
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
                    ?? throw new InvalidOperationException("The Cairn live injector did not start.");
                if (!injection.WaitForExit(5000))
                {
                    try { injection.Kill(); } catch { }
                    throw new IOException("The Cairn live injector did not finish within five seconds.");
                }
                injectorOutput = (injection.StandardOutput.ReadToEnd() + " " +
                    injection.StandardError.ReadToEnd()).Trim();
                if (injection.ExitCode != 0)
                {
                    throw new IOException(
                        $"The Cairn live injector failed with exit code {injection.ExitCode}: {injectorOutput}");
                }
            }

            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                if (state == "ready" || ProcessHasModule(game[0], hook))
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

    public LiveGameStatus ApproveCurrentBuild()
    {
        lock (sync)
        {
            var status = Inspect();
            if (string.IsNullOrWhiteSpace(status.GameDllSha256))
            {
                throw new InvalidOperationException("Start Grim Dawn before approving an exact game build.");
            }
            if (!string.Equals(status.HookSha256, VerifiedRetailHookSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Only the bundled verified Cairn hook may be paired with a user-approved game build.");
            }
            var path = Path.Combine(LiveDataDirectory(), "approved-game-dlls.json");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var approved = ReadApprovedGameDlls();
            approved.Add(status.GameDllSha256);
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(approved.OrderBy(value => value).ToArray()));
            File.Move(temporary, path, true);
            compatibilityProcessId = null;
            cachedCompatibility = null;
            return Inspect();
        }
    }

    public LiveGameStatus Stop()
    {
        StopConnection();
        return Inspect();
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
        VaultItemPayload item,
        string destination = "shared-stash")
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
            var prefix = destination switch
            {
                "shared-stash" => "cairn-",
                "character-inventory" => "cairn-personal-",
                _ => throw new ArgumentException($"Unsupported live retrieval destination: {destination}")
            };
            var filename = $"{prefix}{operationId}.csv";
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
            var queueName = Path.GetFileName(queue.OutgoingPath);
            var exactDeposited = Path.Combine(deleted, queueName);
            var deposited = FileMatchesSemanticHash(exactDeposited, queue.SemanticSha256)
                ? exactDeposited
                : MatchingFiles(deleted, queue.SemanticSha256)
                .Except(queue.BaselineDeleted, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
            if (deposited is not null)
            {
                return new LiveRetrievalStatus("deposited", deposited);
            }
            var incoming = Path.Combine(queueDirectory!, "ingoing");
            var exactRejected = Path.Combine(incoming, queueName);
            var rejected = FileMatchesSemanticHash(exactRejected, queue.SemanticSha256)
                ? exactRejected
                : MatchingFiles(incoming, queue.SemanticSha256)
                .Except(queue.BaselineIncoming, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
            return rejected is null
                ? new LiveRetrievalStatus("unknown", null)
                : new LiveRetrievalStatus("rejected", rejected);
        }
    }

    private static bool FileMatchesSemanticHash(string path, string semanticHash)
    {
        if (!File.Exists(path)) return false;
        try
        {
            var payload = ParseCsv(ReadStable(path));
            var bytes = Encoding.UTF8.GetBytes(SerializeCsv(payload.IsHardcore, payload.Item));
            return Convert.ToHexStringLower(SHA256.HashData(bytes))
                .Equals(semanticHash, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private void DemandReady()
    {
        if (state != "ready" || window == IntPtr.Zero || queueDirectory is null)
        {
            throw new WriteSafetyException("The live-game adapter is not ready.");
        }
        Process? connected = null;
        try
        {
            if (gameProcessId is null)
            {
                throw new WriteSafetyException("The connected Grim Dawn process is no longer available.");
            }
            connected = Process.GetProcessById(gameProcessId.Value);
            var hook = hookPath;
            if (connected.HasExited || hook is null || !ProcessHasModule(connected, hook))
            {
                state = "blocked";
                detail = "The connected Grim Dawn process or live hook exited. Live queue operations are locked.";
                gameProcessId = null;
                isHardcore = null;
                throw new WriteSafetyException(detail);
            }
        }
        catch (ArgumentException)
        {
            state = "blocked";
            detail = "The connected Grim Dawn process exited. Live queue operations are locked.";
            gameProcessId = null;
            isHardcore = null;
            throw new WriteSafetyException(detail);
        }
        finally
        {
            connected?.Dispose();
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
        if (fields.Length is not (17 or 18))
        {
            throw new InvalidDataException($"Expected 17 or 18 live item fields, found {fields.Length}.");
        }
        static uint Number(string value) => uint.TryParse(value, out var parsed) ? parsed : 0;
        var item = new VaultItemPayload(
            11, -1, -1,
            fields[2].Trim(), fields[3].Trim(), fields[4].Trim(), fields[7].Trim(),
            fields[13].Trim(), Number(fields[5]), fields[8].Trim(), fields[9].Trim(),
            Number(fields[10]), fields[11].Trim(), fields[14].Trim(), fields[15].Trim(),
            0, Number(fields[12]), 0,
            fields.Length == 18 ? Math.Max(1, Number(fields[17])) : 1,
            Number(fields[6]), Number(fields[16]), 0, 0);
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
        item.AffixRerolls,
        Math.Max(1, item.StackCount));

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
                if (type == TypeActiveCharacter && data.Length > 0)
                {
                    activeCharacterName = Encoding.Unicode.GetString(data).TrimEnd('\0');
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
            foreach (ProcessModule module in process.Modules)
            {
                if (module.FileName.Equals(modulePath, StringComparison.OrdinalIgnoreCase)) return true;
                if (!module.ModuleName.Equals(Path.GetFileName(modulePath), StringComparison.OrdinalIgnoreCase)) continue;
                if (!File.Exists(module.FileName) || !File.Exists(modulePath)) continue;
                var loadedHash = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(module.FileName)));
                var requestedHash = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(modulePath)));
                if (loadedHash.Equals(requestedHash, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
        catch { return false; }
    }

    private LiveHookCompatibility GetCompatibility(Process game, string hookPath)
    {
        if (compatibilityProcessId == game.Id &&
            string.Equals(compatibilityHookPath, hookPath, StringComparison.OrdinalIgnoreCase) &&
            cachedCompatibility is not null)
        {
            return cachedCompatibility;
        }
        var result = InspectCompatibility(game, hookPath);
        compatibilityProcessId = game.Id;
        compatibilityHookPath = hookPath;
        cachedCompatibility = result;
        return result;
    }

    private static LiveHookCompatibility InspectCompatibility(Process game, string hookPath)
    {
        try
        {
            var hookVersion = FileVersionInfo.GetVersionInfo(hookPath).FileVersion ?? "unknown";
            var hookSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(hookPath)));
            var executable = game.MainModule?.FileName;
            var gameDirectory = executable is null ? null : Path.GetDirectoryName(executable);
            var gameDll = gameDirectory is null ? null : Path.Combine(gameDirectory, "Game.dll");
            var executableInfo = executable is null ? null : FileVersionInfo.GetVersionInfo(executable);
            var gameVersion = executableInfo?.ProductVersion ?? executableInfo?.FileVersion ?? "unknown";
            var gameDllSha256 = gameDll is not null && File.Exists(gameDll)
                ? Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(gameDll)))
                : null;
            var gameBuildId = ReadSteamBuildId(executable);
            var gameDllLastWriteUtc = gameDll is not null && File.Exists(gameDll)
                ? File.GetLastWriteTimeUtc(gameDll).ToString("O")
                : null;
            var knownVersion = gameDllSha256 is not null && VerifiedRetailGameDlls.TryGetValue(gameDllSha256, out var value)
                ? value
                : gameVersion;

            if (hookSha256.Equals(CrashingRetailHookSha256, StringComparison.OrdinalIgnoreCase))
            {
                return new LiveHookCompatibility(false,
                    $"Live mode is disabled for Grim Dawn {gameVersion} with GDIA hook {hookVersion}: " +
                    "this exact hook crashed in the item-replica path during an item drop. Closed-game transfers remain available.",
                    knownVersion, gameBuildId, gameDllSha256, gameDllLastWriteUtc, hookSha256,
                    "Use Offline staging. Replace the incompatible hook before attempting live transfers.");
            }

            var userApproved = gameDllSha256 is not null && ReadApprovedGameDlls().Contains(gameDllSha256);
            if (hookSha256.Equals(VerifiedRetailHookSha256, StringComparison.OrdinalIgnoreCase) &&
                gameDllSha256 is not null && (VerifiedRetailGameDlls.ContainsKey(gameDllSha256) || userApproved))
            {
                return new LiveHookCompatibility(true,
                    userApproved
                        ? $"User-approved exact Grim Dawn build {knownVersion} with verified Cairn Codex hook {hookVersion}."
                        : $"Verified Cairn Codex hook {hookVersion} for Grim Dawn {knownVersion}.",
                    knownVersion, gameBuildId, gameDllSha256, gameDllLastWriteUtc, hookSha256,
                    "Select Connect, or enable Auto-connect for future game sessions.");
            }

            // Injection mutates a running game process. Unknown binaries must be opted in
            // here only after controlled compatibility testing has been documented for
            // the exact Game.dll and hook fingerprints.
            var fingerprint = gameDllSha256 is null ? "unknown" : gameDllSha256[..Math.Min(12, gameDllSha256.Length)];
            return new LiveHookCompatibility(false,
                $"This Grim Dawn build is new to Cairn (Game.dll {fingerprint}). Live injection is blocked until this exact build is verified. " +
                "Closed-game transfers remain available.",
                knownVersion, gameBuildId, gameDllSha256, gameDllLastWriteUtc, hookSha256,
                "Update Cairn Codex after a Grim Dawn patch. Until then, use Offline staging; do not bypass the compatibility check.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return new LiveHookCompatibility(false,
                $"Could not verify the live hook safely: {exception.Message}");
        }
    }

    private static string? ReadSteamBuildId(string? executable)
    {
        if (executable is null) return null;
        var gameDirectory = Directory.GetParent(Path.GetDirectoryName(executable) ?? string.Empty)?.FullName;
        var commonDirectory = gameDirectory is null ? null : Directory.GetParent(gameDirectory)?.FullName;
        var steamAppsDirectory = commonDirectory is null ? null : Directory.GetParent(commonDirectory)?.FullName;
        var manifest = steamAppsDirectory is null ? null : Path.Combine(steamAppsDirectory, "appmanifest_219990.acf");
        if (manifest is null || !File.Exists(manifest)) return null;
        var match = Regex.Match(File.ReadAllText(manifest), "\\\"buildid\\\"\\s+\\\"(?<id>\\d+)\\\"");
        return match.Success ? match.Groups["id"].Value : null;
    }

    private static HashSet<string> ReadApprovedGameDlls()
    {
        var path = Path.Combine(LiveDataDirectory(), "approved-game-dlls.json");
        if (!File.Exists(path)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            return (JsonSerializer.Deserialize<string[]>(File.ReadAllText(path)) ?? [])
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string? ResolveAdapterDirectory()
    {
        var bundled = Path.Combine(AppContext.BaseDirectory, "native");
        return File.Exists(Path.Combine(bundled, "ItemAssistantHook_x64.dll")) &&
               File.Exists(Path.Combine(bundled, "DllInjector64.exe"))
            ? bundled
            : null;
    }

    private static string LiveDataDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "cairn-codex", "live-adapter");
    }

    private static void EnsureLiveSettings()
    {
        var directory = LiveDataDirectory();
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "settings.json");
        if (File.Exists(path)) return;
        var temporary = path + ".tmp";
        var content = JsonSerializer.SerializeToUtf8Bytes(new
        {
            local = new
            {
                stashToLootFrom = 0,
                stashToDepositTo = 0,
                isGrimDawnParsed = true
            },
            persistent = new { isRunningInWine = false }
        });
        File.WriteAllBytes(temporary, content);
        File.Move(temporary, path);
    }

    private static LiveQueueSettings ReadQueueSettings()
    {
        try
        {
            var path = Path.Combine(LiveDataDirectory(), "settings.json");
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
        StopConnection();
        foreach (var process in FindProcesses(["Grim Dawn", "GrimDawn", "IAGrim"])) process.Dispose();
    }

    private void StopConnection()
    {
        var hwnd = window;
        if (hwnd != IntPtr.Zero) PostMessage(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero);
        windowThread?.Join(TimeSpan.FromSeconds(2));
        windowReady?.Dispose();
        // The injected hook caches its host-window lookup for one second and only checks
        // it when the named worker event fires. Wait out that cache, then wake it after
        // our window is gone so interception cannot remain active without Cairn running.
        Thread.Sleep(1100);
        _ = SignalHookWorker();
        lock (sync)
        {
            window = IntPtr.Zero;
            windowThread = null;
            windowReady = null;
            windowProcedure = null;
            hookPath = null;
            queueDirectory = null;
            gameProcessId = null;
            isHardcore = null;
            activeCharacterName = null;
            state = "unavailable";
            detail = "Live mode is disconnected.";
            injectorOutput = null;
        }
    }

    private static bool SignalHookWorker()
    {
        var workerEvent = OpenEvent(0x0002, false, "IA_Worker");
        if (workerEvent == IntPtr.Zero) return false;
        try { return SetEvent(workerEvent); }
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
internal sealed record LiveHookCompatibility(
    bool Verified,
    string? Reason,
    string? GameVersion = null,
    string? GameBuildId = null,
    string? GameDllSha256 = null,
    string? GameDllLastWriteUtc = null,
    string? HookSha256 = null,
    string? Recommendation = null);
internal sealed record LiveQueueSelfTestResult(
    bool Passed,
    int Fields,
    uint Seed,
    uint AffixRerolls,
    string HookSha256,
    string InjectorSha256);
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
    string? AdapterDirectory,
    string? HookVersion,
    int? ConnectedProcessId,
    bool? IsHardcore,
    string? ActiveCharacterName,
    int IngestTabSetting,
    int DepositTabSetting,
    string IngestTabDescription,
    string DepositTabDescription,
    bool HostWindowReady,
    string? InjectorOutput,
    IReadOnlyList<LiveHookMessage> Messages,
    string? GameVersion,
    string? GameBuildId,
    string? GameDllSha256,
    string? GameDllLastWriteUtc,
    string? HookSha256,
    string? Recommendation);

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
