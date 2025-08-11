#!/usr/bin/env python3
import argparse, os, sys, time, json, signal, subprocess
from pathlib import Path
from datetime import datetime
from threading import Thread
from queue import Queue, Empty

# ========== tiny ANSI colors ==========
class C:
    R="\x1b[31m"; G="\x1b[32m"; Y="\x1b[33m"; B="\x1b[34m"; M="\x1b[35m"; C="\x1b[36m"; K="\x1b[90m"; X="\x1b[0m"
def col(s, c, on=True): return f"{c}{s}{C.X}" if on else s
def now(): return datetime.now().strftime("%H:%M:%S")

# ========== helpers ==========
def safe_name(p: Path) -> str:
    return p.name

def write_jsonl(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

def pid_alive(pid: int) -> bool:
    if pid <= 0: return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

# ========== run one file ==========
def run_task(file: Path, engine: str, model: str, sandbox: str, approval: str,
             skip_git_check: bool, colorize: bool, codex_cmd: str, gemini_cmd: str,
             timeout: float | None, retries: int, retry_delay: float,
             results_jsonl: Path | None) -> int:
    """
    On success: writes done_exec_log-<file>.txt, removes marker.
    On failure: writes failed_exec_log-<file>.txt, removes marker.
    Returns rc (0 ok).
    """
    file = file.resolve()
    dirp = file.parent
    base = safe_name(file)
    # markers/logs
    mark = dirp / f"in-progress-{base}"
    done = dirp / f"done_exec_log-{base}.txt"
    failed = dirp / f"failed_exec_log-{base}.txt"
    tmp = dirp / f".tmp_exec_log-{base}.txt"

    # skip if already has done/legacy completed
    if done.exists() or (dirp / f"completed_{base}.txt").exists():
        print(f"[{now()}] {col('skip', C.K, colorize)}  {base}  (done log exists)")
        return 0
    # skip if a marker already exists (another worker)
    if mark.exists():
        print(f"[{now()}] {col('skip', C.K, colorize)}  {base}  (in-progress marker present)")
        return 0

    # create marker containing metadata (pid filled after spawn)
    meta = {
        "file": str(file),
        "engine": engine,
        "model": model,
        "sandbox": sandbox,
        "approval": approval,
        "start": datetime.now().isoformat(timespec="seconds"),
        "pid": None,
    }
    try:
        with mark.open("w", encoding="utf-8") as f:
            json.dump(meta, f)
    except Exception as e:
        print(f"[{now()}] {col('err ', C.R, colorize)} {base} cannot write marker: {e}", file=sys.stderr)
        return 1

    def build_proc():
        if engine == "codex":
            args = [
                codex_cmd,
                "--ask-for-approval", approval,
                "--sandbox", sandbox,
                "--model", model,
                "exec",
            ]
            if skip_git_check:
                args.append("--skip-git-repo-check")
        elif engine == "gemini":
            # minimal one-shot: stdin piped to CLI
            args = [gemini_cmd, "-m", model]
        else:
            raise RuntimeError(f"unknown engine: {engine}")
        return args

    attempt = 0
    start_ts = time.time()
    rc = 1
    try:
        while attempt <= retries:
            attempt += 1
            if attempt > 1:
                print(f"[{now()}] {col('retry', C.Y, colorize)} {base} attempt {attempt}/{retries+1} in {retry_delay:.1f}s")
                time.sleep(retry_delay)

            args = build_proc()
            print(f"[{now()}] {col('run ', C.B, colorize)}  {base}  ({engine}, model={model})")
            # launch
            try:
                fin = file.open("rb")
                tmp.parent.mkdir(parents=True, exist_ok=True)
                fout = tmp.open("wb")
            except Exception as e:
                print(f"[{now()}] {col('err ', C.R, colorize)} {base} open io failed: {e}", file=sys.stderr)
                break

            try:
                proc = subprocess.Popen(
                    args, stdin=fin, stdout=fout, stderr=subprocess.STDOUT
                )
                # update marker with pid
                meta["pid"] = proc.pid
                with mark.open("w", encoding="utf-8") as f:
                    json.dump(meta, f)
                print(f"[{now()}] {col('pid ', C.C, colorize)}  {base}  PID={proc.pid}")

                try:
                    rc = proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    rc = 124
                    try:
                        proc.terminate()
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
                    print(f"[{now()}] {col('time', C.Y, colorize)} {base} timed out (rc=124)")

            finally:
                try: fin.close()
                except Exception: pass
                try: fout.close()
                except Exception: pass

            if rc == 0:
                # success → finalize
                try:
                    if failed.exists(): failed.unlink(missing_ok=True)
                    tmp.replace(done)
                except Exception as e:
                    print(f"[{now()}] {col('err ', C.R, colorize)} {base} finalize failed: {e}", file=sys.stderr)
                    rc = 1
                break
            else:
                # failure → keep tmp as failed (rename)
                try:
                    if tmp.exists():
                        tmp.replace(failed)
                except Exception:
                    pass

        dur = f"{time.time()-start_ts:.1f}s"
        if rc == 0:
            print(f"[{now()}] {col('done', C.G, colorize)} {base} → {done.name} {col('('+dur+')', C.K, colorize)}")
        else:
            print(f"[{now()}] {col('fail', C.R, colorize)} {base} → {failed.name} {col(f'(rc={rc}, {dur})', C.K, colorize)}")

        if results_jsonl:
            write_jsonl(results_jsonl, {
                "ts": datetime.now().isoformat(timespec="seconds"),
                "file": str(file),
                "engine": engine,
                "model": model,
                "rc": rc,
                "duration_sec": round(time.time()-start_ts, 2),
                "pid": meta["pid"],
                "done_log": str(done) if rc==0 else None,
                "failed_log": str(failed) if rc!=0 else None,
            })

        return rc
    finally:
        # always remove marker (don’t delete the original .md)
        try: mark.unlink(missing_ok=True)
        except Exception: pass

# ========== main loop ==========
def main():
    p = argparse.ArgumentParser(
        description="Batch-run code agents on files with in-progress/done markers, pretty logs, retries, and PID tracking."
    )
    p.add_argument("paths", nargs="*", help="Files or directories (default: ./errors if none given)")
    p.add_argument("--glob", default="*.md", help="Pattern when a directory is given (default: *.md)")
    p.add_argument("--engine", choices=["codex","gemini"], default="codex", help="Which CLI to run (default: codex)")
    p.add_argument("--model", default=None, help="Model name (default: codex=o4-mini, gemini=gemini-2.5-pro)")
    p.add_argument("--sandbox", default="read-only", choices=["read-only","workspace-write","danger-full-access"], help="Codex sandbox (default: read-only)")
    p.add_argument("--approval", default="never", choices=["untrusted","on-failure","on-request","never"], help="Codex approvals (default: never)")
    p.add_argument("--no-skip-git-check", action="store_true", help="Do not pass Codex exec --skip-git-repo-check")
    p.add_argument("--sleep", type=float, default=3.0, help="Seconds between launches (default: 3)")
    p.add_argument("--concurrency", type=int, default=1, help="Parallel workers (default: 1)")
    p.add_argument("--timeout", type=float, default=None, help="Per-task timeout in seconds (default: none)")
    p.add_argument("--retries", type=int, default=0, help="Retries on failure (default: 0)")
    p.add_argument("--retry-delay", type=float, default=5.0, help="Seconds between retries (default: 5)")
    p.add_argument("--results-json", default=None, help="Append JSONL results to this file")
    p.add_argument("--codex-cmd", default=os.environ.get("CODEX_CMD","codex"), help="Codex executable (default: codex)")
    p.add_argument("--gemini-cmd", default=os.environ.get("GEMINI_CMD","gemini"), help="Gemini executable (default: gemini)")
    p.add_argument("--cleanup-stale", type=float, default=None, help="Before running, remove in-progress-* if older than N seconds and PID is not alive")
    p.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    p.add_argument("--dry-run", action="store_true", help="List what would run and exit")
    args = p.parse_args()

    colorize = not args.no_color
    engine = args.engine
    model = args.model or ("o4-mini" if engine=="codex" else "gemini-2.5-pro")
    skip_git = not args.no_skip_git_check
    results_jsonl = Path(args.results_json).expanduser().resolve() if args.results_json else None

    # Collect files
    inputs: list[Path] = []
    if not args.paths:
        # default to ./errors
        inputs = [Path("errors")]
    else:
        inputs = [Path(x) for x in args.paths]

    files: list[Path] = []
    for pth in inputs:
        if pth.is_dir():
            files += sorted(pth.glob(args.glob))
        elif pth.is_file():
            files.append(pth)
        else:
            print(f"[{now()}] {col('warn', C.Y, colorize)} not found: {pth}", file=sys.stderr)

    # Filter: skip logs/markers
    def is_task(f: Path) -> bool:
        name = f.name
        if name.startswith("in-progress-"): return False
        if name.startswith("done_exec_log-"): return False
        if name.startswith("completed_"): return False  # legacy
        return True

    files = [f for f in files if is_task(f)]
    if not files:
        print(f"[{now()}] {col('note', C.K, colorize)} nothing to do")
        return 0

    # Optional: cleanup stale markers
    if args.cleanup_stale is not None:
        roots = sorted({f.parent for f in files})
        for d in roots:
            for m in d.glob("in-progress-*"):
                try:
                    with m.open("r", encoding="utf-8") as fh:
                        meta = json.load(fh)
                        pid = int(meta.get("pid") or -1)
                except Exception:
                    pid = -1
                age = time.time() - m.stat().st_mtime
                if (not pid_alive(pid)) and age > args.cleanup_stale:
                    try:
                        m.unlink()
                        print(f"[{now()}] {col('clean', C.M, colorize)} removed stale marker {m.name}")
                    except Exception:
                        pass

    if args.dry_run:
        for f in files:
            print(f"[{now()}] would-run {f}")
        return 0

    # Work queue
    q: Queue[Path] = Queue()
    for f in files: q.put(f)

    successes = 0
    failures = 0

    def worker(idx: int):
        nonlocal successes, failures
        while True:
            try:
                f = q.get_nowait()
            except Empty:
                return
            rc = run_task(
                f, engine, model, args.sandbox, args.approval,
                skip_git, colorize, args.codex_cmd, args.gemini_cmd,
                args.timeout, args.retries, args.retry_delay,
                results_jsonl
            )
            if rc == 0: successes += 1
            else: failures += 1
            time.sleep(args.sleep)
            q.task_done()

    threads = []
    for i in range(max(1, args.concurrency)):
        t = Thread(target=worker, args=(i,), daemon=True)
        t.start()
        threads.append(t)

    try:
        q.join()
    except KeyboardInterrupt:
        print(f"\n[{now()}] {col('int ', C.Y, colorize)} ctrl-c — waiting workers…", file=sys.stderr)

    for t in threads:
        t.join(timeout=1)

    print(f"[{now()}] {col('summary', C.G if failures==0 else C.M, colorize)} ok={successes} fail={failures}")
    return 0 if failures==0 else 1

if __name__ == "__main__":
    sys.exit(main())

