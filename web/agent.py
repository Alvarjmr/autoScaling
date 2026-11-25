#!/usr/bin/env python3
"""Local metadata, real-time CPU monitor, and multi-core stress API for Nginx ALB demo."""

import json
import multiprocessing
import os
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BOOT_TIME = time.time()
CORES = os.cpu_count() or 2

STATE_LOCK = threading.Lock()
CPU_PERCENT = 0.0
STRESS_END_TIME = 0.0
STRESS_PROCS = []
STRESS_STOP_EVENT = None


def fetch_imds_v2():
    """Fetch EC2 instance metadata using IMDSv2 with safe fallback."""
    meta = {
        "instanceId": socket.gethostname(),
        "privateIp": "127.0.0.1",
        "availabilityZone": "local",
        "instanceType": "t3.micro",
        "hostname": socket.gethostname(),
    }
    try:
        token_req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
        )
        with urllib.request.urlopen(token_req, timeout=2) as resp:
            token = resp.read().decode("utf-8")

        headers = {"X-aws-ec2-metadata-token": token}
        paths = {
            "instanceId": "instance-id",
            "privateIp": "local-ipv4",
            "availabilityZone": "placement/availability-zone",
            "instanceType": "instance-type",
        }
        for key, path in paths.items():
            req = urllib.request.Request(
                f"http://169.254.169.254/latest/meta-data/{path}",
                headers=headers,
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                meta[key] = resp.read().decode("utf-8").strip()
    except Exception:
        pass
    return meta


INSTANCE_META = fetch_imds_v2()


def _read_proc_stat():
    with open("/proc/stat", "r", encoding="utf-8") as f:
        parts = f.readline().split()[1:]
    vals = [int(v) for v in parts]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    total = sum(vals)
    return idle, total


def cpu_monitor_loop():
    """Continuously sample /proc/stat every 0.5s for instant non-blocking CPU readings."""
    global CPU_PERCENT
    try:
        prev_idle, prev_total = _read_proc_stat()
    except Exception:
        return
    while True:
        time.sleep(0.5)
        try:
            idle, total = _read_proc_stat()
            d_idle = idle - prev_idle
            d_total = total - prev_total
            prev_idle, prev_total = idle, total
            if d_total > 0:
                usage = (1.0 - (d_idle / d_total)) * 100.0
                with STATE_LOCK:
                    CPU_PERCENT = round(max(0.0, min(100.0, usage)), 1)
        except Exception:
            pass


def _cpu_burn_worker(stop_event):
    """Tight math loop to saturate one vCPU without allocating memory."""
    x = 1.0001
    while not stop_event.is_set():
        for _ in range(10000):
            x = (x * 1.0000001) % 999999.9999 + 1.0001


def _stop_stress_locked():
    global STRESS_END_TIME, STRESS_PROCS, STRESS_STOP_EVENT
    STRESS_END_TIME = 0.0
    if STRESS_STOP_EVENT is not None:
        STRESS_STOP_EVENT.set()
    for p in STRESS_PROCS:
        if p.is_alive():
            p.terminate()
    for p in STRESS_PROCS:
        p.join(timeout=1)
    STRESS_PROCS = []
    STRESS_STOP_EVENT = None


def stress_watchdog_loop():
    """Automatically stop stress workers when duration expires."""
    while True:
        time.sleep(1)
        with STATE_LOCK:
            if STRESS_END_TIME > 0 and time.time() >= STRESS_END_TIME:
                _stop_stress_locked()


def start_stress(duration_sec=360, workers=0):
    """Start or extend multi-core CPU stress."""
    global STRESS_END_TIME, STRESS_PROCS, STRESS_STOP_EVENT
    duration_sec = max(10, min(1800, int(duration_sec)))
    num_workers = max(1, min(8, int(workers) if workers else CORES))

    with STATE_LOCK:
        target_end = time.time() + duration_sec
        if STRESS_PROCS and any(p.is_alive() for p in STRESS_PROCS):
            if target_end > STRESS_END_TIME:
                STRESS_END_TIME = target_end
            return get_status_locked()

        _stop_stress_locked()
        STRESS_STOP_EVENT = multiprocessing.Event()
        STRESS_END_TIME = target_end
        STRESS_PROCS = []
        for _ in range(num_workers):
            p = multiprocessing.Process(
                target=_cpu_burn_worker, args=(STRESS_STOP_EVENT,), daemon=True
            )
            p.start()
            STRESS_PROCS.append(p)
        return get_status_locked()


def stop_stress():
    with STATE_LOCK:
        _stop_stress_locked()
        return get_status_locked()


def get_status_locked():
    now = time.time()
    active = bool(STRESS_PROCS and any(p.is_alive() for p in STRESS_PROCS) and now < STRESS_END_TIME)
    remaining = max(0, int(STRESS_END_TIME - now)) if active else 0
    try:
        load_1m = round(os.getloadavg()[0], 2)
    except Exception:
        load_1m = 0.0
    return {
        **INSTANCE_META,
        "cpuPercent": CPU_PERCENT,
        "cpuCores": CORES,
        "loadAvg1m": load_1m,
        "stressActive": active,
        "stressRemainingSec": remaining,
        "uptimeSec": int(now - BOOT_TIME),
        "timestamp": int(now * 1000),
    }


def get_status():
    with STATE_LOCK:
        return get_status_locked()


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Instance-Id", INSTANCE_META["instanceId"])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            self._send_json(200, {"status": "ok", "instanceId": INSTANCE_META["instanceId"]})
        elif path in ("/api/info", "/api/ping"):
            self._send_json(200, get_status())
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            data = {}

        if path == "/api/stress":
            duration = data.get("duration", 360)
            workers = data.get("workers", 0)
            self._send_json(200, start_stress(duration, workers))
        elif path == "/api/stress/stop":
            self._send_json(200, stop_stress())
        else:
            self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    threading.Thread(target=cpu_monitor_loop, daemon=True).start()
    threading.Thread(target=stress_watchdog_loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 8080), AgentHandler)
    server.serve_forever()
