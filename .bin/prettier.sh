#!/bin/bash

pnpm exec prettier --version
pnpm exec prettier --write --config-path .prettierrc "$@"
