# VPS Benchmark Report

Generated: 2026-04-28

This is a lightweight, low-risk benchmark. It uses built-in Linux tools only:
`lscpu`, `free`, `df`, `lsblk`, `dd`, `openssl speed`, and `ping`.

## Summary

| Server     | Alias          |        Public IP |     Tailscale IP | CPU                               |               Memory | Root Disk | Root Used |  dd Write | SHA256 16K | Notes                                               |
| ---------- | -------------- | ---------------: | ---------------: | --------------------------------- | -------------------: | --------: | --------: | --------: | ---------: | --------------------------------------------------- |
| Hong Kong  | `hk-server`    |  `91.213.189.92` |  `100.98.124.60` | 1 vCPU, Intel Xeon Skylake KVM    |              961 MiB |   8.7 GiB |       45% |  551 MB/s | 415,984k/s | Best disk write among the three; smallest RAM/disk. |
| Hangzhou   | `hz-server`    | `114.55.149.223` | `100.124.170.61` | 2 vCPU, Intel Xeon Platinum KVM   |              1.6 GiB |    40 GiB |       23% |  283 MB/s | 374,167k/s | Best balanced choice for always-on dictionary jobs. |
| Louis / US | `louis-server` |   `66.154.106.3` | `100.114.248.18` | 3 vCPU, Intel Xeon E5-2650 v2 KVM | 1.9 GiB + 1 GiB swap |    30 GiB |       25% | 46.1 MB/s | 236,388k/s | Most CPU cores, but disk write is much slower.      |

## Network Latency

Public IP ping:

| From / To |         Hong Kong Public |          Hangzhou Public | US Public |
| --------- | -----------------------: | -----------------------: | --------: |
| Hong Kong |                        - | blocked/no ICMP response |  189.7 ms |
| Hangzhou  | blocked/no ICMP response |                        - |  241.1 ms |
| US        |                 190.8 ms |                 238.8 ms |         - |

Tailscale IP ping:

| From / To |           Hong Kong TS |            Hangzhou TS |    US TS |
| --------- | ---------------------: | ---------------------: | -------: |
| Hong Kong |                      - | 552.0 ms avg, unstable | 184.7 ms |
| Hangzhou  | 344.5 ms avg, 25% loss |                      - | 249.7 ms |
| US        | 340.9 ms avg, unstable | 309.2 ms avg, unstable |        - |

## Interpretation

| Use Case                                       | Best Server | Reason                                                                                                       |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Long-running dictionary cleaning orchestration | Hangzhou    | Best balance of disk, RAM, location near Aliyun/China network, and enough CPU.                               |
| Small public proxy / lightweight edge service  | Hong Kong   | Good disk write and international connectivity, but only 1 GB RAM and small disk.                            |
| CPU-parallel light jobs                        | US / Louis  | 3 vCPU and most RAM, but disk is slow. Avoid heavy database writes here.                                     |
| Inter-server transfer via Tailscale            | Not ideal   | Tailscale latency is high and unstable between these nodes. Prefer public IP paths where secure and allowed. |

## Caveats

- `dd` result is a small 256 MiB write test, not a full fio latency/IOPS benchmark.
- `openssl speed sha256` is a CPU crypto throughput proxy, not a full Geekbench/sysbench score.
- Ping measures latency only, not bandwidth. For throughput, run `iperf3` or YABS later.
- Public ping to Hangzhou/Hong Kong was blocked in some directions, so those rows show ICMP availability, not necessarily TCP reachability.
