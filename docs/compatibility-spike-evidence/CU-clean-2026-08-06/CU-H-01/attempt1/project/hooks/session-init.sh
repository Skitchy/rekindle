#!/bin/bash
cat > /private/tmp/rk-cu-clean/CU-H-01/attempt1/hook-stdin.json
date +%s > /private/tmp/rk-cu-clean/CU-H-01/attempt1/hook-fired.sentinel
echo "{\"additional_context\": \"RK_IDENTITY_a1558f02 RK_CONSTRAINT_a1558f02 RK_OPEN_LOOP_a1558f02\"}"
