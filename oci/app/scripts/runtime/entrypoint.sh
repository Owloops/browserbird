#!/bin/bash
set -e

exec node --disable-warning=ExperimentalWarning ./bin/browserbird --config oci/app/config/browserbird.json
