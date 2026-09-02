import { execFileSync } from 'node:child_process'

export const BENCHMARK_RENDERER_FAILURE_PREFIX = '[benchmark-renderer-gone]'

export class BenchmarkRendererFailure extends Error {
  constructor(details, stdout, stderr) {
    super(
      `Benchmark renderer exited before producing a report: ${JSON.stringify(details)}.\n` +
      `${stdout}\n${stderr}`
    )
    this.name = 'BenchmarkRendererFailure'
    this.details = details
  }
}

export function benchmarkRendererFailure(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.includes(BENCHMARK_RENDERER_FAILURE_PREFIX))
  const marker = lines.at(-1)
  if (!marker) return null
  const payload = marker.slice(marker.indexOf(BENCHMARK_RENDERER_FAILURE_PREFIX) + BENCHMARK_RENDERER_FAILURE_PREFIX.length)
  try {
    const details = JSON.parse(payload)
    return details && typeof details === 'object' ? details : null
  } catch {
    return null
  }
}

export function shouldRetryWithoutSandbox(error, allowFallback, platform = process.platform) {
  return Boolean(
    allowFallback &&
    platform === 'win32' &&
    error instanceof BenchmarkRendererFailure &&
    error.details?.reason === 'launch-failed'
  )
}

export function benchmarkProcessTermination(child) {
  if (child.exitCode === null && child.signalCode === null) return null
  return {
    exitCode: child.exitCode,
    signalCode: child.signalCode
  }
}

function windowsDescendantPids(rootPid) {
  const nativeSnapshot = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class CairnBenchmarkProcessSnapshot
{
    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static string[] Read()
    {
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == InvalidHandleValue) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var rows = new List<string>();
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    rows.Add(entry.ProcessId + ":" + entry.ParentProcessId);
                    entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
                }
                while (Process32NextW(snapshot, ref entry));
            }
            return rows.ToArray();
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }
}`
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${nativeSnapshot}\n'@`,
    '[CairnBenchmarkProcessSnapshot]::Read()'
  ].join('\n')
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const childrenByParent = new Map()
  for (const row of output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [pidText, parentText] = row.split(':')
    const pid = Number(pidText)
    const parentPid = Number(parentText)
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid) || parentPid < 0) continue
    const siblings = childrenByParent.get(parentPid) ?? []
    siblings.push(pid)
    childrenByParent.set(parentPid, siblings)
  }
  const descendants = []
  const pending = [rootPid]
  while (pending.length) {
    const parentPid = pending.shift()
    for (const pid of childrenByParent.get(parentPid) ?? []) {
      descendants.push(pid)
      pending.push(pid)
    }
  }
  return descendants
}

export async function terminateBenchmarkProcessTree(child, platform = process.platform) {
  const rootPid = child.pid
  if (!rootPid) return
  const wasTerminated = benchmarkProcessTermination(child) !== null

  if (platform === 'win32') {
    const descendantPids = wasTerminated ? windowsDescendantPids(rootPid) : []
    if (!wasTerminated) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        child.kill()
      }
    }
    // Once the parent has already exited, taskkill cannot discover its former tree.
    // The process snapshot retains each live process's parent id, so terminate captured descendants directly.
    for (const pid of descendantPids.reverse()) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        // A descendant may have exited between the snapshot and taskkill.
      }
    }
  } else if (!wasTerminated) {
    child.kill()
  }

  if (benchmarkProcessTermination(child)) return
  const closed = await new Promise((resolveExit) => {
    const onClose = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    const timer = setTimeout(() => {
      child.off('close', onClose)
      resolveExit(false)
    }, 2_000)
    child.once('close', onClose)
  })
  if (!closed && !benchmarkProcessTermination(child)) {
    throw new Error(`Benchmark process tree ${rootPid} did not stop within 2000 ms.`)
  }
}
