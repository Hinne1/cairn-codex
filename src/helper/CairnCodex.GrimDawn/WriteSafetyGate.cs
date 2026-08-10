using System.Diagnostics;

namespace CairnCodex.GrimDawn;

internal static class WriteSafetyGate
{
    private static readonly string[] GrimDawnProcessNames = ["Grim Dawn", "GrimDawn"];
    private static readonly string[] ItemAssistantProcessNames = ["IAGrim"];

    public static WriteSafetyStatus Inspect()
    {
        var grimDawn = FindRunning(GrimDawnProcessNames);
        var itemAssistant = FindRunning(ItemAssistantProcessNames);
        var reasons = new List<string>();
        if (grimDawn.Count > 0)
        {
            reasons.Add("Grim Dawn must be closed before the MVP may write a transfer stash.");
        }
        if (itemAssistant.Count > 0)
        {
            reasons.Add("Grim Dawn Item Assistant must be closed before Cairn Codex accesses its stash.");
        }

        return new WriteSafetyStatus(
            reasons.Count == 0,
            "closed-processes-v1",
            grimDawn,
            itemAssistant,
            reasons);
    }

    public static void DemandPermit()
    {
        var status = Inspect();
        if (!status.Permitted)
        {
            throw new WriteSafetyException(string.Join(' ', status.Reasons));
        }
    }

    private static IReadOnlyList<RunningProcess> FindRunning(IEnumerable<string> processNames)
    {
        var matches = new Dictionary<int, RunningProcess>();
        foreach (var processName in processNames)
        {
            foreach (var process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    matches[process.Id] = new RunningProcess(process.Id, process.ProcessName);
                }
            }
        }
        return matches.Values.OrderBy(process => process.Id).ToArray();
    }
}

internal sealed record WriteSafetyStatus(
    bool Permitted,
    string Gate,
    IReadOnlyList<RunningProcess> GrimDawnProcesses,
    IReadOnlyList<RunningProcess> ItemAssistantProcesses,
    IReadOnlyList<string> Reasons);

internal sealed record RunningProcess(int Id, string Name);

internal sealed class WriteSafetyException(string message) : InvalidOperationException(message);
