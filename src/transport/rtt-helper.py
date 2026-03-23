#!/usr/bin/env python3
"""
RTT reader helper — runs as a long-lived subprocess, reads RTT data via
SEGGER J-Link RTT and writes raw bytes to stdout.

Preferred: pylink (native J-Link RTT, zero packet loss, any J-Link device)
Fallback: nrfutil CLI (nRF devices only, slower, some packet loss)

Usage: python3 rtt-helper.py <device_name_or_rtt_address> [poll_interval_ms] [nrfutil_path]
"""
import struct
import time
import sys
import os


def _find_newest_jlink_dll():
    """Find the newest J-Link DLL on the system.

    pylink defaults to the first DLL it finds (alphabetically), which may be
    an old version missing support for newer chips (e.g., nRF54L15). This
    function scans SEGGER install directories and returns the newest DLL path.
    Returns None if no DLL is found (pylink will use its own default search).
    """
    import glob
    import re

    if sys.platform == "win32":
        search_dirs = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "SEGGER"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "SEGGER"),
        ]
        dll_name = "JLink_x64.dll"
    elif sys.platform == "darwin":
        search_dirs = ["/Applications/SEGGER"]
        dll_name = "libjlinkarm.dylib"
    else:
        # Linux — typically a single install, pylink handles it fine
        return None

    candidates = []
    for base in search_dirs:
        if not os.path.isdir(base):
            continue
        for entry in os.listdir(base):
            dll_path = os.path.join(base, entry, dll_name)
            if os.path.isfile(dll_path):
                # Extract version from directory name (e.g., "JLink_V924a" → "924a")
                m = re.search(r"V(\d+)(\w*)", entry)
                if m:
                    # Sort by numeric part, then alpha suffix
                    candidates.append((int(m.group(1)), m.group(2), dll_path))

    if not candidates:
        return None

    # Pick the highest version
    candidates.sort(reverse=True)
    return candidates[0][2]


def _create_jlink():
    """Create a pylink.JLink instance using the newest available J-Link DLL."""
    import pylink
    dll_path = _find_newest_jlink_dll()
    if dll_path:
        print(f"Using J-Link DLL: {dll_path}", file=sys.stderr)
        sys.stderr.flush()
        return pylink.JLink(lib=pylink.Library(dllpath=dll_path))
    return pylink.JLink()


def run_pylink(device_or_addr, poll_ms, serial_no=None):
    """Fast path: native J-Link RTT via pylink. Works with any J-Link device."""
    import pylink

    jlink = _create_jlink()

    # Check for connected probes BEFORE opening — otherwise the J-Link SDK
    # pops up a native dialog asking about TCP/IP connection.
    if not jlink.connected_emulators():
        print("ERROR: No J-Link probes found. Connect a device via USB and try again.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(3)

    # Pass serial number to avoid probe selection dialog when multiple probes are connected
    if serial_no:
        print(f"Opening J-Link probe SN: {serial_no}", file=sys.stderr)
        sys.stderr.flush()
        jlink.open(serial_no=serial_no)
    else:
        jlink.open()

    # If it looks like a hex address, it's the nrfutil fallback format.
    # For pylink, we need a device name. Default to Cortex-M33 if address given.
    if device_or_addr.startswith("0x"):
        device = "Cortex-M33"
    else:
        device = device_or_addr

    jlink.connect(device)
    print(f"J-Link connected to {device}, CPU halted: {jlink.halted()}", file=sys.stderr)

    # If CPU is halted (shouldn't be with connect), resume it
    if jlink.halted():
        jlink.restart()
        print("Resumed CPU", file=sys.stderr)

    # Start RTT — J-Link handles control block detection automatically
    jlink.rtt_start()
    print("RTT started, waiting for control block...", file=sys.stderr)
    sys.stderr.flush()

    # Wait for RTT to find the control block (up to 5 seconds)
    for _ in range(50):
        try:
            num_up = jlink.rtt_get_num_up_buffers()
            if num_up > 0:
                break
        except Exception:
            pass
        time.sleep(0.1)
    else:
        print("ERROR: Could not connect to device. Make sure firmware with RTT logging is flashed and the device is powered on.", file=sys.stderr)
        jlink.rtt_stop()
        jlink.close()
        sys.exit(2)

    num_up = jlink.rtt_get_num_up_buffers()
    has_hci = num_up >= 2
    print(f"RTT_READY buffers={num_up} hci={'yes' if has_hci else 'no'}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    consecutive_errors = 0
    last_data_time = time.monotonic()
    SILENCE_THRESHOLD = 3.0  # seconds of no data before RTT restart
    reconnect_stage = 0  # 0=normal, 1=tried RTT restart, 2=tried full reconnect
    reconnect_attempts = 0
    MAX_RECONNECT_ATTEMPTS = 3  # exit after this many failed full reconnects

    def write_frame(channel, data):
        """Write framed data: [channel:1][length:4 LE][data:N]"""
        stdout.write(bytes([channel]) + struct.pack('<I', len(data)) + data)

    def restart_rtt():
        """Lightweight RTT restart — stop and re-start RTT without closing J-Link."""
        nonlocal has_hci
        print("Restarting RTT session...", file=sys.stderr)
        sys.stderr.flush()
        try:
            jlink.rtt_stop()
        except Exception:
            pass
        time.sleep(0.3)
        jlink.rtt_start()
        for _ in range(50):
            try:
                num_up = jlink.rtt_get_num_up_buffers()
                if num_up > 0:
                    has_hci = num_up >= 2
                    print(f"RTT restarted OK, buffers={num_up}", file=sys.stderr)
                    sys.stderr.flush()
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        print("RTT restart failed — control block not found", file=sys.stderr)
        sys.stderr.flush()
        return False

    def full_reconnect():
        """Full J-Link + RTT reconnect after board reset."""
        nonlocal has_hci
        print("Full J-Link reconnect...", file=sys.stderr)
        sys.stderr.flush()
        try:
            jlink.rtt_stop()
        except Exception:
            pass
        try:
            jlink.close()
        except Exception:
            pass
        time.sleep(0.5)
        try:
            if serial_no:
                jlink.open(serial_no=serial_no)
            else:
                jlink.open()
            jlink.connect(device)
            if jlink.halted():
                jlink.restart()
            jlink.rtt_start()
        except Exception as e:
            print(f"Reconnect failed: {e}", file=sys.stderr)
            sys.stderr.flush()
            return False
        for _ in range(50):
            try:
                num_up = jlink.rtt_get_num_up_buffers()
                if num_up > 0:
                    has_hci = num_up >= 2
                    print(f"Reconnected OK, buffers={num_up}", file=sys.stderr)
                    sys.stderr.flush()
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        print("Full reconnect failed — control block not found", file=sys.stderr)
        sys.stderr.flush()
        return False

    # Monitor stdin for "quit" command (graceful shutdown from VS Code)
    import threading
    quit_requested = threading.Event()
    def _watch_stdin():
        try:
            for line in sys.stdin:
                if line.strip() == "quit":
                    quit_requested.set()
                    return
        except Exception:
            pass
    stdin_thread = threading.Thread(target=_watch_stdin, daemon=True)
    stdin_thread.start()

    while not quit_requested.is_set():
        try:
            got_data = False

            # Channel 0: log text
            data = jlink.rtt_read(0, 4096)
            if data:
                write_frame(0, bytes(data))
                got_data = True

            # Channel 1: HCI binary (BT Monitor)
            if has_hci:
                hci_data = jlink.rtt_read(1, 4096)
                if hci_data:
                    write_frame(1, bytes(hci_data))
                    got_data = True

            if got_data:
                last_data_time = time.monotonic()
                consecutive_errors = 0
                reconnect_stage = 0
            else:
                silence = time.monotonic() - last_data_time
                # Quick check: is the probe still physically connected?
                if silence > SILENCE_THRESHOLD:
                    try:
                        probes = jlink.connected_emulators()
                        probe_serials = [e.SerialNumber for e in probes]
                        if serial_no and serial_no not in probe_serials:
                            print(f"ERROR: Probe SN {serial_no} no longer connected (found: {probe_serials})", file=sys.stderr)
                            sys.stderr.flush()
                            try:
                                jlink.close()
                            except Exception:
                                pass
                            sys.exit(4)
                        elif not probes:
                            print("ERROR: No J-Link probes connected", file=sys.stderr)
                            sys.stderr.flush()
                            try:
                                jlink.close()
                            except Exception:
                                pass
                            sys.exit(4)
                    except Exception:
                        pass  # can't check — fall through to reconnect logic

                if silence > SILENCE_THRESHOLD and reconnect_stage == 0:
                    # Stage 1: try lightweight RTT restart
                    restart_rtt()
                    last_data_time = time.monotonic()
                    reconnect_stage = 1
                elif silence > SILENCE_THRESHOLD and reconnect_stage == 1:
                    # Stage 2: RTT restart didn't help, try full reconnect
                    if full_reconnect():
                        reconnect_attempts = 0
                    else:
                        reconnect_attempts += 1
                    last_data_time = time.monotonic()
                    reconnect_stage = 2
                elif silence > SILENCE_THRESHOLD and reconnect_stage == 2:
                    # Stage 3: full reconnect didn't help either, retry with limit
                    if full_reconnect():
                        reconnect_attempts = 0
                    else:
                        reconnect_attempts += 1
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS:
                        print("ERROR: Device disconnected — too many failed reconnect attempts", file=sys.stderr)
                        sys.stderr.flush()
                        try:
                            jlink.close()
                        except Exception:
                            pass
                        sys.exit(4)
                    last_data_time = time.monotonic()

        except BrokenPipeError:
            break
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors <= 2:
                print(f"RTT read error #{consecutive_errors}: {e}", file=sys.stderr)
                sys.stderr.flush()
            if consecutive_errors >= 5:
                if not full_reconnect():
                    reconnect_attempts += 1
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS:
                        print("ERROR: Device disconnected — giving up after repeated failures", file=sys.stderr)
                        sys.stderr.flush()
                        try:
                            jlink.close()
                        except Exception:
                            pass
                        sys.exit(4)
                else:
                    reconnect_attempts = 0
                consecutive_errors = 0
                last_data_time = time.monotonic()
                reconnect_stage = 0
            continue

        time.sleep(poll_interval)

    jlink.rtt_stop()
    jlink.close()


def run_nrfutil(rtt_addr, poll_ms, nrfutil_path):
    """Slow fallback: spawns nrfutil CLI per read. nRF devices only."""
    import subprocess

    MAX_CHUNK = 1024

    def swd_read(addr, nbytes):
        aligned = (nbytes + 3) & ~3
        if aligned == 0:
            return b""
        data = bytearray()
        offset = 0
        while offset < aligned:
            chunk = min(MAX_CHUNK, aligned - offset)
            result = subprocess.run(
                [nrfutil_path, "device", "read", "--address", hex(addr + offset),
                 "--bytes", str(chunk), "--direct"],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if line.startswith("0x"):
                    parts = line.split("|")[0].split()
                    for word_hex in parts[1:]:
                        try:
                            word = int(word_hex, 16)
                            data.extend(struct.pack("<I", word))
                        except ValueError:
                            break
            offset += chunk
        return bytes(data[:nbytes])

    def swd_write32(addr, value):
        subprocess.run(
            [nrfutil_path, "device", "write", "--address", hex(addr),
             "--value", hex(value), "--direct"],
            capture_output=True, text=True
        )

    rtt_addr_int = int(rtt_addr, 16) if isinstance(rtt_addr, str) else rtt_addr

    # Read control block
    header = swd_read(rtt_addr_int, 24)
    magic = header[:10].decode("ascii", errors="replace")
    if magic != "SEGGER RTT":
        print(f"ERROR: RTT magic mismatch: '{magic}'", file=sys.stderr)
        sys.exit(2)

    desc = swd_read(rtt_addr_int + 24, 24)
    pbuffer = struct.unpack_from("<I", desc, 4)[0]
    buf_size = struct.unpack_from("<I", desc, 8)[0]
    wr_off_addr = rtt_addr_int + 24 + 12
    rd_off_addr = rtt_addr_int + 24 + 16

    print(f"RTT_READY pbuffer=0x{pbuffer:08x} size={buf_size}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    errors = 0

    while True:
        try:
            offsets = swd_read(wr_off_addr, 8)
            if len(offsets) < 8:
                time.sleep(poll_interval)
                continue
            wr_off = struct.unpack_from("<I", offsets, 0)[0]
            rd_off = struct.unpack_from("<I", offsets, 4)[0]

            if wr_off == rd_off:
                time.sleep(poll_interval)
                continue

            if wr_off > rd_off:
                data = swd_read(pbuffer + rd_off, wr_off - rd_off)
            else:
                data = swd_read(pbuffer + rd_off, buf_size - rd_off)
                if wr_off > 0:
                    data += swd_read(pbuffer, wr_off)

            if data:
                stdout.write(data)
                swd_write32(rd_off_addr, wr_off)
                errors = 0

        except BrokenPipeError:
            break
        except Exception as e:
            errors += 1
            print(f"Poll error #{errors}: {e}", file=sys.stderr)
            if errors > 20:
                print("Too many errors, exiting", file=sys.stderr)
                break
            time.sleep(poll_interval * 2)
            continue

        time.sleep(poll_interval)


def detect_device(nrfutil_path, serial_no=None):
    """Try to auto-detect the connected device via nrfutil."""
    import subprocess
    try:
        cmd = [nrfutil_path, "device", "device-info"]
        if serial_no:
            cmd.extend(["--serial-number", str(serial_no)])
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("deviceVersion:"):
                # e.g. "deviceVersion: NRF54L15_xxAA_REV2" → "NRF54L15_M33"
                dev = line.split(":")[1].strip()
                # Map to J-Link device name
                base = dev.split("_xx")[0]  # "NRF54L15"
                # Map to friendly name (nRF not NRF)
                friendly = base.replace("NRF", "nRF")  # "NRF54L15" → "nRF54L15"
                # Common core suffixes for J-Link device name
                m33_devices = ["NRF54L15", "NRF54H20", "NRF5340", "NRF9160", "NRF9161"]
                m4_devices = ["NRF52840", "NRF52833", "NRF52832", "NRF52820", "NRF52810"]
                if base in m33_devices:
                    return f"{base}_M33", friendly
                elif base in m4_devices:
                    return f"{base}_XXAA", friendly
                else:
                    return f"{base}_M33", friendly
    except Exception:
        pass
    return None, None


def _parse_probe_label(emu):
    """Extract a human-readable label from the J-Link emulator product string.

    Note: For on-board J-Links (OB-*), the chip in the product string is the
    DEBUGGER chip, not the target. E.g., "J-Link OB-nRF5340-NordicSemi" means
    the debugger is an nRF5340, but the target could be an nRF54L15 or anything
    else. So we return a probe description, not a target name.
    """
    try:
        product = emu.acProduct
        if isinstance(product, bytes):
            product = product.decode("utf-8", errors="replace")
        # Clean up the product string for display
        # "J-Link OB-nRF5340-NordicSemi" → "J-Link OB"
        # "J-Link EDU Mini" → "J-Link EDU Mini"
        if "OB-" in product:
            return "J-Link (On-Board)"
        return product.strip() if product.strip() else None
    except Exception:
        pass
    return None


def _get_candidate_devices(jlink):
    """Get a list of specific device names to try from the J-Link database.

    Scans the J-Link SDK's built-in device list for known target chips.
    Trying these before generic cores (Cortex-M33 etc.) lets the J-Link know
    the exact RAM layout, which is required for RTT auto-detection on newer chips.
    """
    candidates = []
    try:
        # Prioritize common Nordic chips with M33 core suffix
        priority_patterns = ["nRF54L15", "nRF54L10", "nRF54L05", "nRF54H20",
                             "nRF5340", "nRF9161", "nRF9160", "nRF9151",
                             "nRF52840", "nRF52833", "nRF52832"]
        found = set()
        for i in range(jlink.num_supported_devices()):
            info = jlink.supported_device(i)
            name = info.name
            # Only include M33 and XXAA variants (main application cores)
            if not (name.endswith("_M33") or name.endswith("_XXAA") or name.endswith("_XXAB")):
                continue
            for pattern in priority_patterns:
                if name.startswith(pattern) and name not in found:
                    candidates.append(name)
                    found.add(name)
                    break
    except Exception:
        pass
    return candidates


def run_discover():
    """Discover connected J-Link probes and output JSON to stdout."""
    import json
    try:
        import pylink
    except ImportError:
        print(json.dumps({"error": "pylink not installed", "devices": []}))
        return

    # First, try nrfutil to get the actual target chip name
    nrfutil_path = sys.argv[2] if len(sys.argv) > 2 else "nrfutil"
    target_jlink, target_friendly = detect_device(nrfutil_path)

    try:
        jlink = _create_jlink()
        emulators = jlink.connected_emulators()
    except Exception as e:
        # J-Link DLL not found or other initialization error
        print(f"J-Link init failed: {e}", file=sys.stderr)
        print(json.dumps({"error": str(e), "devices": []}))
        return

    devices = []
    for emu in emulators:
        serial = emu.SerialNumber
        info = {"serial": serial}

        if target_friendly:
            # nrfutil identified the target chip (e.g., "nRF54L15")
            info["targetName"] = target_friendly
            info["device"] = target_jlink
        else:
            # Get a human-readable probe label
            probe_label = _parse_probe_label(emu)

            # Try to identify the target by connecting with specific device names
            # from the J-Link database, then fall back to generic core names.
            # Using a specific device name (e.g., "nRF54L15_M33") is critical —
            # it tells the J-Link the exact RAM layout so RTT auto-detection works.
            specific_devices = _get_candidate_devices(jlink)
            generic_cores = ["Cortex-M33", "Cortex-M4", "Cortex-M7", "Cortex-M0+"]

            try:
                jlink.open(serial_no=serial)

                # Try specific devices first (gives us chip name + correct RAM map)
                for dev in specific_devices:
                    try:
                        jlink.connect(dev)
                        info["device"] = dev
                        # Extract friendly name: "nRF54L15_M33" → "nRF54L15"
                        info["targetName"] = dev.rsplit("_", 1)[0]
                        break
                    except Exception:
                        continue
                else:
                    # Fall back to generic core names
                    for core in generic_cores:
                        try:
                            jlink.connect(core)
                            info["device"] = core
                            break
                        except Exception:
                            continue
                    info["targetName"] = probe_label or info.get("device", "Unknown device")

                jlink.close()
            except Exception:
                info["targetName"] = probe_label or "Unknown device"
                try:
                    jlink.close()
                except Exception:
                    pass
        devices.append(info)
    print(json.dumps({"devices": devices}))


def main():
    if len(sys.argv) < 2:
        print("Usage: rtt-helper.py <device_or_rtt_address|discover> [poll_ms] [nrfutil_path]", file=sys.stderr)
        sys.exit(1)

    device_or_addr = sys.argv[1]

    # Discovery mode — just list connected probes and exit
    if device_or_addr == "discover":
        run_discover()
        return

    poll_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    nrfutil_path = sys.argv[3] if len(sys.argv) > 3 else "nrfutil"
    serial_no = int(sys.argv[4]) if len(sys.argv) > 4 else None

    # Auto-detect device if requested
    if device_or_addr == "auto":
        jlink_name, friendly_name = detect_device(nrfutil_path, serial_no=serial_no)
        if jlink_name:
            print(f"DEVICE_DETECTED {friendly_name}", file=sys.stderr)
            sys.stderr.flush()
            device_or_addr = jlink_name
        else:
            # nrfutil not available — try identifying the target by connecting
            # with specific device names from the J-Link database. This is
            # critical because generic "Cortex-M33" doesn't give the J-Link
            # the RAM layout needed for RTT auto-detection on newer chips.
            try:
                import pylink
                probe = _create_jlink()
                if serial_no:
                    probe.open(serial_no=serial_no)
                else:
                    probe.open()
                for dev in _get_candidate_devices(probe):
                    try:
                        probe.connect(dev)
                        friendly = dev.rsplit("_", 1)[0]
                        print(f"DEVICE_DETECTED {friendly}", file=sys.stderr)
                        sys.stderr.flush()
                        device_or_addr = dev
                        probe.close()
                        break
                    except Exception:
                        continue
                else:
                    probe.close()
                    print("Could not auto-detect device, using Cortex-M33", file=sys.stderr)
                    sys.stderr.flush()
                    device_or_addr = "Cortex-M33"
            except Exception:
                print("Could not auto-detect device, using Cortex-M33", file=sys.stderr)
                sys.stderr.flush()
                device_or_addr = "Cortex-M33"

    # Try pylink first (native J-Link RTT, works with any J-Link device)
    try:
        import pylink  # noqa: F401
        print("Using pylink (native J-Link RTT)", file=sys.stderr)
        sys.stderr.flush()
        run_pylink(device_or_addr, poll_ms, serial_no=serial_no)
    except ImportError:
        print("pylink not available, falling back to nrfutil CLI", file=sys.stderr)
        sys.stderr.flush()
        run_nrfutil(device_or_addr, poll_ms, nrfutil_path)


if __name__ == "__main__":
    main()
