#!/bin/bash
# Cursor-channel shim: adapts the sealed session-start probe to Cursor's hook
# contract (JSON out, additional_context key). Probe logic untouched.
export REKINDLE_SPIKE_RUN_ID="CU-H-02-clean-r2-952c46"
export REKINDLE_SPIKE_CLIENT="cursor"
export REKINDLE_SPIKE_CLIENT_VERSION="$(cursor-agent --version 2>/dev/null | head -1)"
export REKINDLE_SPIKE_RECEIPT_PATH="/private/tmp/rk-cu-clean/CU-H-02/attempt2/receipts.jsonl"
export REKINDLE_ORIENTATION_BYPASS=1
tee /private/tmp/rk-cu-clean/CU-H-02/attempt2/hook-stdin.json | node /private/tmp/rk-cu-spike/build/scripts/compatibility-spike/session-start-probe.mjs > /private/tmp/rk-cu-clean/CU-H-02/attempt2/probe-raw-out.json
if [ -s /private/tmp/rk-cu-clean/CU-H-02/attempt2/probe-raw-out.json ]; then
  python3 -c "import json,sys; d=json.load(open('/private/tmp/rk-cu-clean/CU-H-02/attempt2/probe-raw-out.json')); print(json.dumps({'additional_context': d['hookSpecificOutput']['additionalContext']}))"
fi
