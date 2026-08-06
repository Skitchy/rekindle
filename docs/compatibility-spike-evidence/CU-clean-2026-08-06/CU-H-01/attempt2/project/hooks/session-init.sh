#!/bin/bash
cat > /private/tmp/rk-cu-clean/CU-H-01/attempt2/hook-stdin.json
date +%s > /private/tmp/rk-cu-clean/CU-H-01/attempt2/hook-fired.sentinel
echo "{\"additional_context\": \"RK_IDENTITY_040cb272 RK_CONSTRAINT_040cb272 RK_OPEN_LOOP_040cb272\"}"
