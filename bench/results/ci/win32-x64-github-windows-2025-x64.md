# win32-x64, github-windows-2025-x64

2026-11-07T09:41:00.708Z: AMD EPYC 9V45 96-Core Processor (2 logical); Bun 1.4.4, Node v24.22.1; commit fb35f1b; 10 runs per route in a rotated order after one warm-up. Compare routes within this file only.

## `stock-small` (passed)

| Route | Median ms | Min–max ms | CV | Peak MiB |
| --- | --- | --- | --- | --- |
| quint-ts | 1021 | 975–1431 | 11.9 % | 259 |
| quint-ts-nocache | 1336 | 1268–1858 | 13.9 % | 336 |
| tla-ts | 348 | 303–557 | 18.9 % | 161 |

Cache warm against cache off: 315 ms less at the median.

## `stock-large` (passed)

| Route | Median ms | Min–max ms | CV | Peak MiB |
| --- | --- | --- | --- | --- |
| quint-ts | 2137 | 1901–2349 | 6.3 % | 306 |
| quint-ts-nocache | 2315 | 2120–2526 | 6.3 % | 358 |
| tla-ts | 1409 | 1299–1609 | 7.0 % | 210 |

Cache warm against cache off: 178 ms less at the median.

## `stock-deep-fault` (violated)

| Route | Median ms | Min–max ms | CV | Peak MiB |
| --- | --- | --- | --- | --- |
| quint-ts | 2082 | 2013–2190 | 3.0 % | 303 |
| quint-ts-nocache | 2266 | 2172–2367 | 2.6 % | 367 |
| tla-ts | 1382 | 1354–1474 | 2.9 % | 212 |

Cache warm against cache off: 183 ms less at the median.

## `tokens` (passed)

| Route | Median ms | Min–max ms | CV | Peak MiB |
| --- | --- | --- | --- | --- |
| quint-ts | 1042 | 992–1129 | 3.4 % | 257 |
| quint-ts-nocache | 1259 | 1213–1305 | 2.6 % | 315 |
| tla-ts | 276 | 260–324 | 6.1 % | 163 |

Cache warm against cache off: 217 ms less at the median.
