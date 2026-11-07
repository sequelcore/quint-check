# Runs one command inside a Windows Job Object and prints, as JSON, its wall
# time, exit code and the peak committed memory of the whole process tree
# (the job's PeakJobMemoryUsed), so a child such as Java started by Quint
# counts. The process starts suspended and joins the job before it runs.
# Usage: measure.ps1 <spec.json>, where the spec is {"exe", "args": [...], "out"};
# stdout and stderr go to "out". A file, since PowerShell would read an
# argument such as -e as one of its own parameters.
param([Parameter(Mandatory)][string]$Spec)
$job = Get-Content -Raw -Encoding UTF8 $Spec | ConvertFrom-Json
$Exe = $job.exe
$Rest = @($job.args)
$Out = $job.out

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JobRun {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr r1, desktop, title; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, stdIn, stdOut, stdErr; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long t1, t2; public uint flags; public UIntPtr minWs, maxWs; public uint active; public UIntPtr affinity; public uint prio, sched; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr procMem, jobMem, peakProcMem, peakJobMem; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int len; public IntPtr desc; public int inherit; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out EXTENDED_LIMIT info, int len, IntPtr ret);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Run(string cmdLine, string outFile) {
    var sa = new SECURITY_ATTRIBUTES { len = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), inherit = 1 };
    IntPtr file = CreateFileW(outFile, 0x40000000, 3, ref sa, 2, 0x80, IntPtr.Zero);
    var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), flags = 0x100, stdOut = file, stdErr = file };
    PROCESS_INFORMATION pi;
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    var started = System.Diagnostics.Stopwatch.StartNew();
    // CREATE_SUSPENDED | CREATE_NO_WINDOW
    if (!CreateProcessW(null, new System.Text.StringBuilder(cmdLine), IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x08000000, IntPtr.Zero, null, ref si, out pi))
      return "{\"error\":\"CreateProcess failed: " + Marshal.GetLastWin32Error() + "\"}";
    AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    started.Stop();
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    EXTENDED_LIMIT info;
    QueryInformationJobObject(job, 9, out info, Marshal.SizeOf(typeof(EXTENDED_LIMIT)), IntPtr.Zero);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(file); CloseHandle(job);
    return "{\"ms\":" + started.Elapsed.TotalMilliseconds.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"exit\":" + code + ",\"peakBytes\":" + info.peakJobMem.ToUInt64() + "}";
  }
}
"@

function Quote([string]$a) { if ($a -notmatch '[\s"]') { return $a }; '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
$resolved = (Get-Command $Exe -CommandType Application | Select-Object -First 1).Source
$line = (@($resolved) + $Rest | ForEach-Object { Quote $_ }) -join ' '
[JobRun]::Run($line, [System.IO.Path]::GetFullPath($Out))
