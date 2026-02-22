#!/bin/bash
set -e

exec node --disable-warning=ExperimentalWarning ./bin/browserbird start --config oci/app/config/browserbird.json
